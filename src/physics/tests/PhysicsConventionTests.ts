import assert from 'node:assert/strict';
import { DriverAidsSystem } from '../DriverAids';
import { DifferentialSystem } from '../Differential';
import { calculateAntiRollBarForces } from '../Suspension';
import { TireModel, type TireModelConfig } from '../TireModel';

const DT = 1 / 120;

function makeDriverAids() {
  return new DriverAidsSystem({
    absMode: 'FULL',
    tcsMode: 'FULL',
    wheelbase: 3.00482,
    trackWidth: 1.67259,
    ackermannRatio: 0.90,
    maxSteerAngle: 0.58,
    steerSpeed: 4.8,
    steerSpeedReduction: 0.60,
    tcsFullSlipThreshold: 0.12,
    tcsFullResponse: 16,
    tcsFullGain: 3,
  });
}

function testAckermannMirrorInvariant() {
  const steering = makeDriverAids();
  const speedMs = 6;

  const left = steering.updateSteering(0.75, speedMs, 1);
  assert(left.steerFL > 0 && left.steerFR > 0, 'positive steering must turn both front wheels left');
  assert(Math.abs(left.steerFL) > Math.abs(left.steerFR), 'left turn must give inside FL more lock than outside FR');

  steering.reset();
  const right = steering.updateSteering(-0.75, speedMs, 1);
  assert(right.steerFL < 0 && right.steerFR < 0, 'negative steering must turn both front wheels right');
  assert(Math.abs(right.steerFR) > Math.abs(right.steerFL), 'right turn must give inside FR more lock than outside FL');

  assert(Math.abs(Math.abs(left.steerFL) - Math.abs(right.steerFR)) < 1e-10, 'Ackermann inner-wheel magnitudes must mirror');
  assert(Math.abs(Math.abs(left.steerFR) - Math.abs(right.steerFL)) < 1e-10, 'Ackermann outer-wheel magnitudes must mirror');
}

function testCamberThrustPointsInwardAndMirrors() {
  const config: TireModelConfig = {
    baseGrip: 1.21,
    stiffnessB: 15,
    loadSensitivity: 0.000030,
    slideFrictionMultiplier: 0.83,
    relaxationLength: 0.19,
    pneumaticTrailMax: 0.03,
    camberStiffness: 85,
    optimalTemp: 75,
    basePressurePsi: 35,
    referenceLoadN: 6200,
  };
  const tire = new TireModel(config);

  const left = tire.calculate({
    slipRatio: 0,
    slipAngle: 0,
    verticalLoad: 6200,
    camberDeg: -2,
    surfaceFriction: 1,
    isLeft: true,
  });
  const right = tire.calculate({
    slipRatio: 0,
    slipAngle: 0,
    verticalLoad: 6200,
    camberDeg: -2,
    surfaceFriction: 1,
    isLeft: false,
  });

  // Canonical wheel lateral axis is +X / vehicle-left. Negative camber leans the
  // left tire inward/right (-Fy) and the right tire inward/left (+Fy).
  assert(left.fy < 0, `negative camber on left tire must thrust inward/right, got Fy=${left.fy}`);
  assert(right.fy > 0, `negative camber on right tire must thrust inward/left, got Fy=${right.fy}`);
  assert(Math.abs(left.fy + right.fy) < 1e-9, `equal mirrored camber thrust must cancel: left=${left.fy}, right=${right.fy}`);
}

function testAntiRollBarSignAndConservationInvariant() {
  const rate = 46000;
  const leftCompressed = calculateAntiRollBarForces(0.030, -0.010, rate);
  assert(leftCompressed.differentialTravelM > 0, 'left-more-compressed case must have positive differential travel');
  assert(leftCompressed.leftChassisForceN > 0, 'positive differential travel must produce positive left chassis ARB reaction');
  assert(leftCompressed.rightChassisForceN < 0, 'positive differential travel must produce negative right chassis ARB reaction');
  assert(Math.abs(leftCompressed.leftChassisForceN + leftCompressed.rightChassisForceN) < 1e-12, 'ARB reactions must be exactly equal and opposite');
  assert(Math.abs(leftCompressed.leftChassisForceN - rate * leftCompressed.differentialTravelM) < 1e-12, 'ARB left force must equal rate times differential travel');

  const rightCompressed = calculateAntiRollBarForces(-0.010, 0.030, rate);
  assert(rightCompressed.differentialTravelM < 0, 'right-more-compressed case must have negative differential travel');
  assert(rightCompressed.leftChassisForceN < 0, 'negative differential travel must reverse left chassis ARB reaction');
  assert(rightCompressed.rightChassisForceN > 0, 'negative differential travel must reverse right chassis ARB reaction');
  assert(Math.abs(leftCompressed.leftChassisForceN + rightCompressed.leftChassisForceN) < 1e-12, 'mirrored ARB travel must mirror force magnitude');

  const heave = calculateAntiRollBarForces(0.025, 0.025, rate);
  assert(heave.differentialTravelM === 0, 'equal bump must have zero differential travel');
  assert(heave.leftChassisForceN === 0 && heave.rightChassisForceN === 0, 'equal bump/heave must create zero ARB force');
}

function seedDirection(aids: DriverAidsSystem, wheelOmega: number) {
  aids.updateABS([0, 0, 0, 0], [wheelOmega, wheelOmega, wheelOmega, wheelOmega], 10, false, DT);
}

function testAbsForwardReverseSymmetry() {
  const forward = makeDriverAids();
  const reverse = makeDriverAids();

  const forwardPressure = forward.updateABS(
    [-0.25, -0.25, -0.25, -0.25],
    [20, 20, 20, 20],
    10,
    true,
    DT
  );
  const reversePressure = reverse.updateABS(
    [0.25, 0.25, 0.25, 0.25],
    [-20, -20, -20, -20],
    10,
    true,
    DT
  );

  assert(forwardPressure[0] < 1, 'forward braking lock must make ABS release pressure');
  assert(reversePressure[0] < 1, 'reverse braking lock must make ABS release pressure');
  for (let i = 0; i < 4; i++) {
    assert(Math.abs(forwardPressure[i] - reversePressure[i]) < 1e-12, `ABS must mirror forward/reverse at wheel ${i}`);
  }
}

function testTcsForwardReverseSymmetry() {
  const forward = makeDriverAids();
  const reverse = makeDriverAids();
  seedDirection(forward, 20);
  seedDirection(reverse, -20);

  const forwardSpin = forward.updateTCS([0.30, 0.28], DT);
  const reverseSpin = reverse.updateTCS([-0.30, -0.28], DT);

  assert(forwardSpin.tcsActive, 'forward wheelspin must activate TCS');
  assert(reverseSpin.tcsActive, 'reverse wheelspin must activate TCS');
  assert(
    Math.abs(forwardSpin.throttleMultiplier - reverseSpin.throttleMultiplier) < 1e-12,
    'TCS intervention must mirror forward/reverse wheelspin'
  );

  const forwardBrake = makeDriverAids();
  const reverseBrake = makeDriverAids();
  seedDirection(forwardBrake, 20);
  seedDirection(reverseBrake, -20);
  assert(!forwardBrake.updateTCS([-0.30], DT).tcsActive, 'forward braking slip must not be classified as wheelspin');
  assert(!reverseBrake.updateTCS([0.30], DT).tcsActive, 'reverse braking slip must not be classified as wheelspin');
}

function axleBiasMagnitude(torques: [number, number, number, number]) {
  return Math.abs(torques[2] - torques[3]);
}

function testDifferentialPowerCoastDirectionInvariant() {
  const diff = new DifferentialSystem({
    type: 'TORQUE_VECTOR',
    powerRamp: 0.90,
    coastRamp: 0.20,
    preloadTorque: 40,
    drivetrain: 'RWD',
  });

  const forwardPower = diff.distributeTorque(1000, [0, 0, 25, 15]);
  const reversePower = diff.distributeTorque(-1000, [0, 0, -25, -15]);
  const forwardCoast = diff.distributeTorque(-1000, [0, 0, 25, 15]);
  const reverseCoast = diff.distributeTorque(1000, [0, 0, -25, -15]);

  const fPowerBias = axleBiasMagnitude(forwardPower.wheelTorques);
  const rPowerBias = axleBiasMagnitude(reversePower.wheelTorques);
  const fCoastBias = axleBiasMagnitude(forwardCoast.wheelTorques);
  const rCoastBias = axleBiasMagnitude(reverseCoast.wheelTorques);

  assert(Math.abs(fPowerBias - rPowerBias) < 1e-9, 'LSD power-ramp strength must mirror in reverse');
  assert(Math.abs(fCoastBias - rCoastBias) < 1e-9, 'LSD coast-ramp strength must mirror in reverse');
  assert(fPowerBias > fCoastBias * 1.5, 'configured power ramp must lock more strongly than coast ramp');

  const sumForward = forwardPower.wheelTorques.reduce((sum, torque) => sum + torque, 0);
  const sumReverse = reversePower.wheelTorques.reduce((sum, torque) => sum + torque, 0);
  assert(Math.abs(sumForward - 1000) < 1e-9, 'forward differential must conserve commanded torque');
  assert(Math.abs(sumReverse + 1000) < 1e-9, 'reverse differential must conserve commanded torque');
}

function testActiveDifferentialDoesNotLockAtZeroDrivelineTorque() {
  const diff = new DifferentialSystem({
    type: 'TORQUE_VECTOR',
    powerRamp: 0.88,
    coastRamp: 0.48,
    preloadTorque: 100,
    drivetrain: 'AWD',
    frontTorqueRatio: 0.40,
  });

  // Tight-turn wheel speeds deliberately differ left/right and front/rear. With
  // zero driveshaft torque, an active torque-vectoring unit must not inject equal-
  // and-opposite wheel torques merely because the wheels follow different radii.
  const coastNeutral = diff.distributeTorque(0, [4.0, 5.5, 4.2, 5.2]);
  for (let i = 0; i < 4; i++) {
    assert(
      Math.abs(coastNeutral.wheelTorques[i]) < 1e-12,
      `active differential injected ${coastNeutral.wheelTorques[i]} Nm at wheel ${i} with zero driveline torque`
    );
  }
}

const tests: Array<[string, () => void]> = [
  ['Ackermann left/right mirror invariant', testAckermannMirrorInvariant],
  ['camber thrust inward/mirror invariant', testCamberThrustPointsInwardAndMirrors],
  ['anti-roll bar sign/conservation invariant', testAntiRollBarSignAndConservationInvariant],
  ['ABS forward/reverse invariant', testAbsForwardReverseSymmetry],
  ['TCS forward/reverse invariant', testTcsForwardReverseSymmetry],
  ['differential power/coast invariant', testDifferentialPowerCoastDirectionInvariant],
  ['active differential zero-torque invariant', testActiveDifferentialDoesNotLockAtZeroDrivelineTorque],
];

for (const [name, test] of tests) {
  test();
  console.log(`PASS ${name}`);
}

console.log(`PASS all ${tests.length} physics convention guardrail tests`);

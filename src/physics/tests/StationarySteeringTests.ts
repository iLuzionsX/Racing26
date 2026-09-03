import { WheelDynamics } from '../WheelDynamics';
import { Simulation } from '../Simulation';
import { DEFAULT_VEHICLE_CONFIG } from '../vehiclePresets';
import { BMW_M5_2025_OVERRIDES } from '../m5G90';
import type { VehicleConfig, ControlInputs } from '../../types';

const DT = 1 / 120;

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function assertFinite(value: number, label: string) {
  assert(Number.isFinite(value), `${label} must remain finite, got ${value}`);
}

function makeM5Wheel(id: 'FL' | 'FR', isLeft: boolean) {
  return new WheelDynamics({
    id,
    isFront: true,
    isLeft,
    radius: 0.369,
    inertia: 2.10,
    tireConfig: {
      baseGrip: 1.21,
      stiffnessB: 15.0,
      loadSensitivity: 0.000030,
      slideFrictionMultiplier: 0.83,
      relaxationLength: 0.19,
      longitudinalRelaxationLength: 0.12,
      longitudinalForceRelaxationLength: 0.066,
      pneumaticTrailMax: 0.030,
      camberStiffness: 85,
      optimalTemp: 75,
      basePressurePsi: 35,
      sidewallStiffness: 230000,
      verticalStiffness: 280000,
      referenceLoadN: 6200,
    },
  });
}

function testStationaryCamberDoesNotCreatePlanarForce() {
  for (const [id, isLeft] of [['FL', true], ['FR', false]] as const) {
    const wheel = makeM5Wheel(id, isLeft);
    wheel.reset(0);
    let maxPlanarForce = 0;
    let maxSkidIntensity = 0;

    for (let i = 0; i < 720; i++) {
      const out = wheel.update(0, 0, 6200, -1.5, 0, 0, 0, 1.0, 0.015, DT);
      maxPlanarForce = Math.max(maxPlanarForce, Math.hypot(out.fx, out.fy));
      maxSkidIntensity = Math.max(maxSkidIntensity, out.skidIntensity);
      assert(!out.isSkidding, `${id}: stationary tire must never be marked skidding`);
    }

    assert(maxPlanarForce < 1.0, `${id}: stationary cambered tire invented ${maxPlanarForce.toFixed(2)} N planar force`);
    assert(maxSkidIntensity === 0, `${id}: stationary tire produced skid intensity ${maxSkidIntensity}`);
  }
}

function testCreepBrushForceIsBoundedAndDissipative() {
  const wheel = makeM5Wheel('FL', true);
  wheel.reset(0);

  let maxForce = 0;
  let maxFrictionLimit = 0;
  let sawSkid = false;
  for (let i = 0; i < 240; i++) {
    const vy = i < 120 ? 0.03 : -0.03;
    const out = wheel.update(0, vy, 6200, -1.5, 0, 0, 0, 1, 0.015, DT);
    maxForce = Math.max(maxForce, Math.hypot(out.fx, out.fy));
    maxFrictionLimit = Math.max(maxFrictionLimit, out.frictionLimit);
    sawSkid ||= out.isSkidding;
    assertFinite(out.fx, 'creep fx');
    assertFinite(out.fy, 'creep fy');
    assert(out.frictionLimit > 5000, `creep friction limit unexpectedly low: ${out.frictionLimit}`);
    assert(Math.hypot(out.fx, out.fy) <= out.frictionLimit * 1.001, 'creep force exceeded friction circle');
  }

  assert(!sawSkid, '3 cm/s parking-speed patch motion must not trigger tire smoke/skid state');
  assert(maxForce > 500, `creep brush failed to develop a meaningful restoring force: ${maxForce.toFixed(1)} N`);
  assert(maxForce <= maxFrictionLimit * 1.001, `creep brush exceeded physical static-friction cap: ${maxForce.toFixed(1)} N > ${maxFrictionLimit.toFixed(1)} N`);
}

function testRealWheelspinStillProducesSkid() {
  const wheel = makeM5Wheel('FL', true);
  wheel.reset(0);

  let sawSkid = false;
  let peakIntensity = 0;
  for (let i = 0; i < 240; i++) {
    const out = wheel.update(0, 0, 6200, -1.5, 3500, 0, 0, 1, 0.015, DT);
    sawSkid ||= out.isSkidding;
    peakIntensity = Math.max(peakIntensity, out.skidIntensity);
  }

  assert(sawSkid, 'real high-energy wheelspin must still enter the skid state');
  assert(peakIntensity > 0.05, `real wheelspin skid intensity too low: ${peakIntensity}`);
}

type StationaryScenarioResult = {
  startPlanarSpeed: number;
  maxPlanarSpeed: number;
  maxYawRate: number;
  horizontalDisplacement: number;
  dx: number;
  dz: number;
  maxTempRise: number;
  maxSkidIntensity: number;
  skidFrames: number;
  maxSlipAngle: number;
  maxSlipRatio: number;
  maxPlanarTireForce: number;
  skidByWheel: Record<string, number>;
};

function runStationaryVehicleScenario(steer: number, label: string): StationaryScenarioResult {
  const config = { ...DEFAULT_VEHICLE_CONFIG, ...BMW_M5_2025_OVERRIDES } as VehicleConfig;
  const sim = new Simulation(config);
  sim.reset(0, 0, 0);

  const neutral: ControlInputs = {
    throttle: 0,
    brake: 0,
    steer: 0,
    handbrake: false,
    shiftUp: false,
    shiftDown: false,
  };

  for (let i = 0; i < 480; i++) sim.stepExplicit(neutral, 1);

  const start = sim.vehicle.getState();
  const startPlanarSpeed = Math.hypot(start.vx, start.vz);
  const startTemp = start.wheels.map((w) => w.temperature);
  const steering: ControlInputs = { ...neutral, steer };

  let maxPlanarSpeed = 0;
  let maxYawRate = 0;
  let maxSkidIntensity = 0;
  let skidFrames = 0;
  let maxSlipAngle = 0;
  let maxSlipRatio = 0;
  let maxPlanarTireForce = 0;
  const skidByWheel: Record<string, number> = { FL: 0, FR: 0, RL: 0, RR: 0 };

  for (let i = 0; i < 720; i++) {
    const state = sim.stepExplicit(steering, 1);
    const planarSpeed = Math.hypot(state.vx, state.vz);
    maxPlanarSpeed = Math.max(maxPlanarSpeed, planarSpeed);
    maxYawRate = Math.max(maxYawRate, Math.abs(state.yawRate));

    for (const wheel of state.wheels) {
      assertFinite(wheel.forceVectorLat, `${label} ${wheel.id} lateral force`);
      assertFinite(wheel.forceVectorLong, `${label} ${wheel.id} longitudinal force`);
      maxSkidIntensity = Math.max(maxSkidIntensity, wheel.skidIntensity);
      maxSlipAngle = Math.max(maxSlipAngle, Math.abs(wheel.slipAngle));
      maxSlipRatio = Math.max(maxSlipRatio, Math.abs(wheel.slipRatio));
      maxPlanarTireForce = Math.max(maxPlanarTireForce, Math.hypot(wheel.forceVectorLong, wheel.forceVectorLat));
      if (wheel.isSkidding) {
        skidFrames++;
        skidByWheel[wheel.id] = (skidByWheel[wheel.id] || 0) + 1;
      }
    }
  }

  const end = sim.vehicle.getState();
  const dx = end.x - start.x;
  const dz = end.z - start.z;
  const horizontalDisplacement = Math.hypot(dx, dz);
  const maxTempRise = Math.max(...end.wheels.map((w, i) => w.temperature - startTemp[i]));

  console.log(
    `  ${label}: vstart=${startPlanarSpeed.toFixed(4)}, vmax=${maxPlanarSpeed.toFixed(4)} m/s, ` +
      `yaw=${maxYawRate.toFixed(4)} rad/s, dx=${dx.toFixed(4)}, dz=${dz.toFixed(4)}, ` +
      `migration=${horizontalDisplacement.toFixed(4)} m, dT=${maxTempRise.toFixed(4)} C, ` +
      `skidFrames=${skidFrames}, skidI=${maxSkidIntensity.toFixed(3)}, ` +
      `alpha=${maxSlipAngle.toFixed(3)} rad, kappa=${maxSlipRatio.toFixed(3)}, ` +
      `Ftire=${maxPlanarTireForce.toFixed(0)} N, wheels=${JSON.stringify(skidByWheel)}`
  );

  return {
    startPlanarSpeed,
    maxPlanarSpeed,
    maxYawRate,
    horizontalDisplacement,
    dx,
    dz,
    maxTempRise,
    maxSkidIntensity,
    skidFrames,
    maxSlipAngle,
    maxSlipRatio,
    maxPlanarTireForce,
    skidByWheel,
  };
}

function testStationaryFullLockVehicle() {
  const straight = runStationaryVehicleScenario(0, 'straight');
  const left = runStationaryVehicleScenario(1, 'full-left');
  const right = runStationaryVehicleScenario(-1, 'full-right');

  for (const [label, result] of [['straight', straight], ['full-left', left], ['full-right', right]] as const) {
    assert(result.skidFrames === 0, `${label}: parked vehicle reported ${result.skidFrames} skid/smoke wheel-frames`);
    assert(result.maxSkidIntensity === 0, `${label}: parked vehicle reached skid intensity ${result.maxSkidIntensity}`);
    assert(result.maxPlanarSpeed < 0.12, `${label}: chassis shook/moved at ${result.maxPlanarSpeed.toFixed(3)} m/s while parked`);
    assert(result.maxYawRate < 0.12, `${label}: chassis yaw oscillation reached ${result.maxYawRate.toFixed(3)} rad/s while parked`);
    assert(result.horizontalDisplacement < 0.08, `${label}: parked car migrated ${result.horizontalDisplacement.toFixed(3)} m`);
    assert(result.maxTempRise < 0.10, `${label}: parked state heated a tire by ${result.maxTempRise.toFixed(3)} C`);
  }

  const speedAsymmetry = Math.abs(left.maxPlanarSpeed - right.maxPlanarSpeed);
  const displacementAsymmetry = Math.abs(left.horizontalDisplacement - right.horizontalDisplacement);
  assert(speedAsymmetry < 0.05, `left/right stationary speed response differs by ${speedAsymmetry.toFixed(3)} m/s`);
  assert(displacementAsymmetry < 0.05, `left/right stationary migration differs by ${displacementAsymmetry.toFixed(3)} m`);
}

function main() {
  const tests: Array<[string, () => void]> = [
    ['stationary camber creates no planar force', testStationaryCamberDoesNotCreatePlanarForce],
    ['parking-speed brush force is bounded and non-smoking', testCreepBrushForceIsBoundedAndDissipative],
    ['real wheelspin still produces skid', testRealWheelspinStillProducesSkid],
    ['parked M5 remains stable straight and at full lock', testStationaryFullLockVehicle],
  ];

  for (const [name, test] of tests) {
    test();
    console.log(`PASS ${name}`);
  }

  console.log(`PASS all ${tests.length} stationary/low-speed tire regression tests`);
}

main();

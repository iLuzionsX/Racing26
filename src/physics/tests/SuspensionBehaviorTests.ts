import { PhysicsMath } from '../math/PhysicsMath';
import {
  SuspensionSystem,
  progressiveSpringIncrement,
  damperForceForVelocity,
  bumpStopForceForDisplacement,
  calculateAntiRollBarForces,
  type SuspensionCornerConfig,
} from '../Suspension';

const assert = (condition: boolean, message: string) => {
  if (!condition) throw new Error(message);
};

const assertNear = (actual: number, expected: number, tolerance: number, message: string) => {
  assert(Math.abs(actual - expected) <= tolerance, `${message}: ${actual} vs ${expected}`);
};

const DT = 1 / 120;
const M5_MASS_KG = 2381.8135;
const M5_UNSPRUNG_MASS_KG = 55;
const M5_TIRE_VERTICAL_STIFFNESS = 280000;
const M5_TIRE_VERTICAL_DAMPING = 1800;

const baseRate = 62000;
const maxBump = 0.14;
const lowTravelSlope = progressiveSpringIncrement(0.03, baseRate, maxBump, 0.65) / 0.03;
const highTravelSlope = (
  progressiveSpringIncrement(0.12, baseRate, maxBump, 0.65) -
  progressiveSpringIncrement(0.09, baseRate, maxBump, 0.65)
) / 0.03;
assert(
  highTravelSlope > lowTravelSlope * 1.10,
  'spring force curve must become stiffer deeper into bump travel'
);

const bumpDamper = damperForceForVelocity(0.25, 5200, 3000, 6500, 4000);
const reboundDamper = damperForceForVelocity(-0.25, 5200, 3000, 6500, 4000);
assert(bumpDamper > 0, 'compression damping must add upward chassis support force');
assert(reboundDamper < 0, 'rebound damping must oppose extension');
assert(
  Math.abs(reboundDamper) > Math.abs(bumpDamper),
  'M5 low/mid-speed rebound should be stronger than bump damping'
);

assertNear(
  bumpStopForceForDisplacement(0.10, 0.14, 0.80, 70000),
  0,
  1e-9,
  'bump stop engaged before threshold'
);
const earlyBumpStop = bumpStopForceForDisplacement(0.12, 0.14, 0.80, 70000);
const deepBumpStop = bumpStopForceForDisplacement(0.135, 0.14, 0.80, 70000);
assert(deepBumpStop > earlyBumpStop * 2, 'bump stop must ramp progressively near full jounce');

// Anti-roll bar unit regressions. A physical bar reacts only to DIFFERENTIAL
// travel. Equal bump must never add heave stiffness or create free vertical load.
const equalBumpBar = calculateAntiRollBarForces(0.05, 0.05, 46000);
assertNear(equalBumpBar.leftChassisForceN, 0, 1e-9, 'equal bump created left ARB force');
assertNear(equalBumpBar.rightChassisForceN, 0, 1e-9, 'equal bump created right ARB force');
assertNear(equalBumpBar.transferMagnitudeN, 0, 1e-9, 'equal bump created ARB load transfer');

// In a left turn the right/outside suspension is more compressed in this fixture.
// The bar must add support at the outside corner and remove the exact same amount
// from the inside corner: no net heave force, only a resisting roll moment.
const rightOutsideBar = calculateAntiRollBarForces(0.02, 0.06, 46000);
assertNear(rightOutsideBar.leftChassisForceN, -1840, 1e-9, 'inside front ARB unloading is wrong');
assertNear(rightOutsideBar.rightChassisForceN, 1840, 1e-9, 'outside front ARB loading is wrong');
assertNear(
  rightOutsideBar.leftChassisForceN + rightOutsideBar.rightChassisForceN,
  0,
  1e-9,
  'anti-roll bar must be equal-and-opposite across an axle'
);

const leftOutsideBar = calculateAntiRollBarForces(0.06, 0.02, 46000);
assert(leftOutsideBar.leftChassisForceN > 0, 'left/outside compression must load the left corner');
assert(leftOutsideBar.rightChassisForceN < 0, 'left/outside compression must unload the right corner');

// Front/rear bar balance controls which axle receives more lateral load transfer.
// With load-sensitive tires downstream, more transfer on one axle reduces that
// axle pair's total available grip and therefore changes understeer/oversteer balance.
const m5FrontBar = calculateAntiRollBarForces(0.02, 0.06, 46000);
const m5RearBar = calculateAntiRollBarForces(0.02, 0.06, 40000);
const m5FrontTransferShare =
  m5FrontBar.transferMagnitudeN /
  (m5FrontBar.transferMagnitudeN + m5RearBar.transferMagnitudeN);
assert(m5FrontTransferShare > 0.50, 'M5 front bar should carry slightly more bar load transfer than rear');

const frontStiffBalance = calculateAntiRollBarForces(0.02, 0.06, 60000);
const frontSoftRear = calculateAntiRollBarForces(0.02, 0.06, 30000);
const frontStiffTransferShare =
  frontStiffBalance.transferMagnitudeN /
  (frontStiffBalance.transferMagnitudeN + frontSoftRear.transferMagnitudeN);
assert(
  frontStiffTransferShare > m5FrontTransferShare,
  'stiffening the front bar must move roll/load-transfer share toward the front axle'
);

const rearSoftFront = calculateAntiRollBarForces(0.02, 0.06, 30000);
const rearStiffBalance = calculateAntiRollBarForces(0.02, 0.06, 60000);
const rearStiffFrontShare =
  rearSoftFront.transferMagnitudeN /
  (rearSoftFront.transferMagnitudeN + rearStiffBalance.transferMagnitudeN);
assert(
  rearStiffFrontShare < m5FrontTransferShare,
  'stiffening the rear bar must move roll/load-transfer share toward the rear axle'
);

const corner: SuspensionCornerConfig = {
  restLength: 0.34,
  springStiffness: 62000,
  dampingLowSpeed: 5200,
  dampingHighSpeed: 3000,
  dampingRebound: 6500,
  bumpStopStiffness: 70000,
  bumpStopThreshold: 0.80,
  maxDroop: 0.12,
  maxBump: 0.14,
  staticCamberDeg: -1.5,
  camberGainDegPerMeter: 7.5,
  antiDiveSquatRatio: 0.45,
};

const hardpoints = [
  PhysicsMath.vec3(-0.84, 0, 1.5), // FL: negative X is left
  PhysicsMath.vec3(0.84, 0, 1.5),  // FR: positive X is right
  PhysicsMath.vec3(-0.84, 0, -1.5),
  PhysicsMath.vec3(0.84, 0, -1.5),
] as [
  ReturnType<typeof PhysicsMath.vec3>,
  ReturnType<typeof PhysicsMath.vec3>,
  ReturnType<typeof PhysicsMath.vec3>,
  ReturnType<typeof PhysicsMath.vec3>,
];

const configs: [
  SuspensionCornerConfig,
  SuspensionCornerConfig,
  SuspensionCornerConfig,
  SuspensionCornerConfig,
] = [corner, corner, corner, corner];

const zero = PhysicsMath.vec3();
const flatOrientation = PhysicsMath.quatFromEuler(0, 0, 0);
let roadElevation = 0;
const flatSurface = () => ({
  elevation: roadElevation,
  normal: PhysicsMath.vec3(0, 1, 0),
});

const makeM5Suspension = () => {
  const suspension = new SuspensionSystem();
  suspension.setUnsprungMassCorner(M5_UNSPRUNG_MASS_KG);
  suspension.tireVerticalDampingNsPerM = M5_TIRE_VERTICAL_DAMPING;
  return suspension;
};

const stepFixture = (
  suspension: SuspensionSystem,
  bodyY: number,
  orientation = flatOrientation,
  bodyVelocityY = 0,
  rollStiffnessFront = 46000,
  rollStiffnessRear = 40000,
  antiRollCrossCoupling = 0.30
) => {
  suspension.update(
    hardpoints,
    PhysicsMath.vec3(0, bodyY, 0),
    orientation,
    PhysicsMath.vec3(0, bodyVelocityY, 0),
    zero,
    flatSurface,
    configs,
    rollStiffnessFront,
    rollStiffnessRear,
    antiRollCrossCoupling,
    0.369,
    M5_TIRE_VERTICAL_STIFFNESS,
    DT
  );
};

const settleFixture = (
  suspension: SuspensionSystem,
  bodyY: number,
  orientation = flatOrientation,
  steps = 360
) => {
  for (let i = 0; i < steps; i++) stepFixture(suspension, bodyY, orientation);
};

// Static flat-road symmetry with the wheel/hub masses fully settled.
const suspension = makeM5Suspension();
roadElevation = 0;
settleFixture(suspension, 0.80);
const flatLoads = suspension.states.map((state) => state.chassisForceN);
assertNear(flatLoads[0], flatLoads[1], 0.01, 'flat front axle must be left/right symmetric');
assertNear(flatLoads[2], flatLoads[3], 0.01, 'flat rear axle must be left/right symmetric');
assertNear(suspension.states[0].antiRollBarForceN, 0, 0.01, 'flat road created front-left ARB force');
assertNear(suspension.states[1].antiRollBarForceN, 0, 0.01, 'flat road created front-right ARB force');
assert(
  suspension.states.every((state) => Math.abs(state.unsprungMassKg - 55) < 1e-9),
  'M5 effective unsprung mass must be 55 kg at every corner'
);

// Corner-load sign convention regression.
// In this coordinate system left is -X and right is +X. A real LEFT turn rolls
// the body toward the RIGHT/outside tires, which is negative Z roll here.
// Therefore FR + RR MUST gain load relative to FL + RL. Reversing this assertion
// would intentionally make the inside tires heavier, which is physically wrong.
const leftTurnRoll = PhysicsMath.quatFromEuler(0, 0, -2.0 * Math.PI / 180);
settleFixture(suspension, 0.80, leftTurnRoll, 240);
const leftTurnLoads = suspension.states.map((state) => state.chassisForceN);
assert(leftTurnLoads[1] > leftTurnLoads[0], 'left turn must load outside/right FRONT tire');
assert(leftTurnLoads[3] > leftTurnLoads[2], 'left turn must load outside/right REAR tire');
assert(suspension.states[1].antiRollBarForceN > 0, 'front bar must load the outside/right corner');
assert(suspension.states[0].antiRollBarForceN < 0, 'front bar must unload the inside/left corner');
assertNear(
  suspension.states[0].antiRollBarForceN + suspension.states[1].antiRollBarForceN,
  0,
  0.01,
  'front ARB forces are not equal-and-opposite in the integrated solver'
);
assertNear(
  suspension.states[2].antiRollBarForceN + suspension.states[3].antiRollBarForceN,
  0,
  0.01,
  'rear ARB forces are not equal-and-opposite in the integrated solver'
);
assert(
  leftTurnLoads[1] + leftTurnLoads[3] > leftTurnLoads[0] + leftTurnLoads[2],
  'left turn must increase total right/outside corner load'
);

const rightTurnRoll = PhysicsMath.quatFromEuler(0, 0, 2.0 * Math.PI / 180);
settleFixture(suspension, 0.80, rightTurnRoll, 240);
const rightTurnLoads = suspension.states.map((state) => state.chassisForceN);
assert(rightTurnLoads[0] > rightTurnLoads[1], 'right turn must load outside/left FRONT tire');
assert(rightTurnLoads[2] > rightTurnLoads[3], 'right turn must load outside/left REAR tire');

// Integrated balance regression: the axle with the stiffer bar must develop the
// larger tire-normal-load split under the same fixed body roll. This is the path
// that reaches TireModel.loadSensitivity and changes handling balance in Vehicle.
const frontBiasedSuspension = makeM5Suspension();
roadElevation = 0;
for (let i = 0; i < 720; i++) {
  stepFixture(frontBiasedSuspension, 0.80, leftTurnRoll, 0, 60000, 20000, 0);
}
const frontBiasedFrontSplit = Math.abs(
  frontBiasedSuspension.states[1].tireNormalForceN - frontBiasedSuspension.states[0].tireNormalForceN
);
const frontBiasedRearSplit = Math.abs(
  frontBiasedSuspension.states[3].tireNormalForceN - frontBiasedSuspension.states[2].tireNormalForceN
);
assert(
  frontBiasedFrontSplit > frontBiasedRearSplit,
  'front-stiff ARB balance did not increase front axle tire-load transfer'
);

const rearBiasedSuspension = makeM5Suspension();
roadElevation = 0;
for (let i = 0; i < 720; i++) {
  stepFixture(rearBiasedSuspension, 0.80, leftTurnRoll, 0, 20000, 60000, 0);
}
const rearBiasedFrontSplit = Math.abs(
  rearBiasedSuspension.states[1].tireNormalForceN - rearBiasedSuspension.states[0].tireNormalForceN
);
const rearBiasedRearSplit = Math.abs(
  rearBiasedSuspension.states[3].tireNormalForceN - rearBiasedSuspension.states[2].tireNormalForceN
);
assert(
  rearBiasedRearSplit > rearBiasedFrontSplit,
  'rear-stiff ARB balance did not increase rear axle tire-load transfer'
);

// Unsprung-mass regression: a 10 mm road step must NOT teleport the hub through
// the same 10 mm in a single 120 Hz frame. The tire deflects and accelerates the
// 55 kg wheel/hub first; suspension travel follows dynamically.
settleFixture(suspension, 0.80, flatOrientation, 300);
const beforeBumpHubY = suspension.states[0].hubPositionWorldY;
const beforeBumpTravel = suspension.states[0].displacement;
roadElevation = 0.010;
stepFixture(suspension, 0.80, flatOrientation);
const oneStepBump = suspension.states[0];
const oneStepHubRise = oneStepBump.hubPositionWorldY - beforeBumpHubY;
const oneStepTravelChange = oneStepBump.displacement - beforeBumpTravel;
assert(oneStepHubRise > 0, 'wheel/hub must begin moving upward after a bump');
assert(oneStepHubRise < 0.006, 'wheel/hub moved almost kinematically instead of carrying inertia');
assert(
  oneStepTravelChange < 0.006,
  'suspension travel followed the entire road step in one frame; unsprung inertia is missing'
);
assert(
  oneStepBump.unsprungAccelerationMps2 > 0,
  'road step must create upward unsprung acceleration before the chassis follows'
);

// Full 1D heave experiment: allow the 2.381 t body to move vertically while all
// four wheels cross a smooth 40 mm bump. Tire load must peak before chassis force,
// and body heave must peak substantially later than both.
const heaveSuspension = makeM5Suspension();
roadElevation = 0;
let bodyY = 0.80;
let bodyVelocityY = 0;

const stepHeaveBody = () => {
  stepFixture(heaveSuspension, bodyY, flatOrientation, bodyVelocityY);
  const chassisForce = heaveSuspension.states.reduce(
    (sum, state) => sum + state.chassisForceN,
    0
  );
  const tireForce = heaveSuspension.states.reduce(
    (sum, state) => sum + state.tireNormalForceN,
    0
  );
  const bodyAccelerationY = chassisForce / M5_MASS_KG - 9.81;
  bodyVelocityY += bodyAccelerationY * DT;
  bodyY += bodyVelocityY * DT;
  return { chassisForce, tireForce, bodyAccelerationY };
};

for (let i = 0; i < 1200; i++) stepHeaveBody();
const settledBodyY = bodyY;
assert(Math.abs(bodyVelocityY) < 0.001, 'heave fixture failed to settle before bump test');

let tirePeak = { value: -Infinity, time: 0 };
let chassisPeak = { value: -Infinity, time: 0 };
let bodyHeavePeak = { value: -Infinity, time: 0 };
const bumpDuration = 0.18;

for (let i = 0; i < 240; i++) {
  const time = i * DT;
  roadElevation = time < bumpDuration
    ? 0.040 * 0.5 * (1 - Math.cos((2 * Math.PI * time) / bumpDuration))
    : 0;

  const sample = stepHeaveBody();
  const heave = bodyY - settledBodyY;
  if (sample.tireForce > tirePeak.value) tirePeak = { value: sample.tireForce, time };
  if (sample.chassisForce > chassisPeak.value) chassisPeak = { value: sample.chassisForce, time };
  if (heave > bodyHeavePeak.value) bodyHeavePeak = { value: heave, time };
}

assert(
  tirePeak.time < chassisPeak.time,
  `tire load must peak before chassis load: tire=${tirePeak.time}s chassis=${chassisPeak.time}s`
);
assert(
  chassisPeak.time < bodyHeavePeak.time,
  `chassis force must peak before body heave: chassis=${chassisPeak.time}s body=${bodyHeavePeak.time}s`
);
assert(
  bodyHeavePeak.time - tirePeak.time > 0.06,
  '2.4-ton chassis response is too immediate relative to the wheel/tire bump event'
);
assert(
  bodyHeavePeak.value > 0 && bodyHeavePeak.value < 0.05,
  `40 mm bump produced implausible body heave: ${bodyHeavePeak.value} m`
);

// Physical travel and hard-stop regression after the dynamic wheel has time to reach jounce.
const hardStopSuspension = makeM5Suspension();
roadElevation = 0;
for (let i = 0; i < 300; i++) {
  stepFixture(hardStopSuspension, 0.55, flatOrientation, 0, 0, 0, 0);
}
assertNear(
  hardStopSuspension.states[0].displacement,
  corner.maxBump,
  1e-9,
  'suspension exceeded configured max bump travel'
);
assert(hardStopSuspension.states[0].atCompressionLimit, 'compression limit was not reported');
assert(hardStopSuspension.states[0].bumpStopForceN > 0, 'bump stop did not engage near full jounce');
assert(hardStopSuspension.states[0].hardStopForceN > 0, 'hard stop did not transmit load at full jounce');

// Frequency sanity gates for a heavy luxury-performance sedan. These are not
// arbitrary gameplay targets: they ensure the sprung and unsprung modes remain
// clearly separated instead of moving as one rigid body.
const wheelHopHz = Math.sqrt(
  (M5_TIRE_VERTICAL_STIFFNESS + baseRate) / M5_UNSPRUNG_MASS_KG
) / (2 * Math.PI);
const approximateSprungCornerMass = M5_MASS_KG / 4 - M5_UNSPRUNG_MASS_KG;
const bodyRideHz = Math.sqrt(baseRate / approximateSprungCornerMass) / (2 * Math.PI);
assert(wheelHopHz >= 9 && wheelHopHz <= 15, `wheel-hop frequency unrealistic: ${wheelHopHz} Hz`);
assert(bodyRideHz >= 1.4 && bodyRideHz <= 2.0, `body ride frequency unrealistic: ${bodyRideHz} Hz`);

console.log(JSON.stringify({
  progressiveLowTravelSlope: lowTravelSlope,
  progressiveHighTravelSlope: highTravelSlope,
  bumpDamperForceN: bumpDamper,
  reboundDamperForceN: reboundDamper,
  antiRollBars: {
    equalBumpTransferN: equalBumpBar.transferMagnitudeN,
    rightOutsideFrontTransferN: rightOutsideBar.transferMagnitudeN,
    m5FrontTransferShare,
    frontStiffTransferShare,
    rearStiffFrontShare,
    frontBiasedFrontTireLoadSplitN: frontBiasedFrontSplit,
    frontBiasedRearTireLoadSplitN: frontBiasedRearSplit,
    rearBiasedFrontTireLoadSplitN: rearBiasedFrontSplit,
    rearBiasedRearTireLoadSplitN: rearBiasedRearSplit,
  },
  flatLoadsN: flatLoads,
  leftTurnLoadsN: leftTurnLoads,
  rightTurnLoadsN: rightTurnLoads,
  oneStep10mmBump: {
    hubRiseM: oneStepHubRise,
    suspensionTravelChangeM: oneStepTravelChange,
    unsprungAccelerationMps2: oneStepBump.unsprungAccelerationMps2,
  },
  smooth40mmBump: {
    tirePeakTimeSec: tirePeak.time,
    chassisForcePeakTimeSec: chassisPeak.time,
    bodyHeavePeakTimeSec: bodyHeavePeak.time,
    bodyHeavePeakM: bodyHeavePeak.value,
  },
  wheelHopHz,
  bodyRideHz,
  status: 'passed',
}, null, 2));

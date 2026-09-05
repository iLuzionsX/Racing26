import { PhysicsMath } from '../math/PhysicsMath';
import {
  createVirtualSuspensionCornerGeometry,
  solveSuspensionKinematics,
  staticRollCenterBodyY,
  transformForceToCommandFrame,
  transformVelocityToKinematicFrame,
} from '../SuspensionKinematics';

const assert = (condition: boolean, message: string) => {
  if (!condition) throw new Error(message);
};
const assertNear = (actual: number, expected: number, tolerance: number, message: string) => {
  assert(Math.abs(actual - expected) <= tolerance, `${message}: ${actual} vs ${expected}`);
};

const trackHalf = 1.67259 * 0.5;
const frontZ = 3.00482 * (1 - 0.545);
const makeFront = (isLeft: boolean) => createVirtualSuspensionCornerGeometry({
  mountBody: PhysicsMath.vec3(isLeft ? trackHalf : -trackHalf, 0, frontZ),
  isFront: true,
  isLeft,
  restLength: 0.34,
  maxDroopM: 0.12,
  maxBumpM: 0.14,
  wheelRadiusM: 0.369,
  staticCamberDeg: -1.5,
  targetCamberGainDegPerMeter: 7.5,
  casterDeg: 7.2,
  kingpinInclinationDeg: 7.0,
  bumpSteerBiasM: 0.0015,
});

const fl = makeFront(true);
const fr = makeFront(false);
assertNear(fl.derivedCamberGainDegPerMeter, -7.5, 0.05, 'front camber-gain fit missed target');
assertNear(fr.derivedCamberGainDegPerMeter, -7.5, 0.05, 'mirrored front camber-gain fit missed target');

const flRollCenterBodyY = staticRollCenterBodyY(fl);
const frRollCenterBodyY = staticRollCenterBodyY(fr);
const flContactBodyY = fl.hubCenterAtRestBody.y - fl.wheelRadiusM;
const frontRollCenterHeightM = flRollCenterBodyY - flContactBodyY;
assertNear(
  flRollCenterBodyY,
  frRollCenterBodyY,
  1e-9,
  'front static roll center must mirror left/right'
);
assert(
  frontRollCenterHeightM > 0.02 && frontRollCenterHeightM < 0.12,
  `front static roll-center height is implausible: ${frontRollCenterHeightM} m`
);

// Regression for the tuning UI's mild-camber-gain end. The virtual hardpoint
// fitter must be able to represent 2 deg/m rather than bottoming out around 3 deg/m.
const mildGain = createVirtualSuspensionCornerGeometry({
  mountBody: PhysicsMath.vec3(0.76, 0, 1.25),
  isFront: true,
  isLeft: true,
  restLength: 0.30,
  maxDroopM: 0.10,
  maxBumpM: 0.12,
  wheelRadiusM: 0.33,
  staticCamberDeg: -1.0,
  targetCamberGainDegPerMeter: 2.0,
  casterDeg: 6.5,
  kingpinInclinationDeg: 6.0,
});
assertNear(mildGain.derivedCamberGainDegPerMeter, -2.0, 0.05, 'mild camber-gain fit missed target');
const mildStatic = solveSuspensionKinematics(mildGain, 0, 0);
const mildBump = solveSuspensionKinematics(mildGain, 0.05, 0);
assertNear(mildBump.camberDeg - mildStatic.camberDeg, -0.10, 0.03, 'mild camber gain over +50 mm is incorrect');

const flStatic = solveSuspensionKinematics(fl, 0, 0);
const frStatic = solveSuspensionKinematics(fr, 0, 0);
assertNear(flStatic.camberDeg, -1.5, 0.02, 'FL static camber changed');
assertNear(frStatic.camberDeg, -1.5, 0.02, 'FR static camber changed');
assertNear(flStatic.casterDeg, 7.2, 0.05, 'FL caster changed');
assertNear(frStatic.casterDeg, 7.2, 0.05, 'FR caster changed');
assertNear(flStatic.kingpinInclinationDeg, 7.0, 0.05, 'FL KPI changed');
assertNear(frStatic.kingpinInclinationDeg, 7.0, 0.05, 'FR KPI changed');
assert(Math.abs(flStatic.scrubRadiusM) < 0.04, `FL scrub radius implausible: ${flStatic.scrubRadiusM}`);
assertNear(flStatic.scrubRadiusM, frStatic.scrubRadiusM, 1e-6, 'scrub radius must mirror symmetrically');

const flBump = solveSuspensionKinematics(fl, 0.05, 0);
const frBump = solveSuspensionKinematics(fr, 0.05, 0);
const flDroop = solveSuspensionKinematics(fl, -0.05, 0);
assert(flBump.camberDeg < flStatic.camberDeg - 0.25, 'compression must gain negative camber');
assert(flDroop.camberDeg > flStatic.camberDeg, 'droop must unwind negative camber');
assertNear(flBump.camberDeg, frBump.camberDeg, 0.01, 'left/right camber gain lost symmetry');
assert(Math.abs(flBump.bumpSteerDeg) < 0.25, `FL bump steer too large at +50 mm: ${flBump.bumpSteerDeg}`);
assert(Math.abs(frBump.bumpSteerDeg) < 0.25, `FR bump steer too large at +50 mm: ${frBump.bumpSteerDeg}`);
assertNear(flBump.bumpSteerDeg, -frBump.bumpSteerDeg, 0.01, 'bump steer must mirror left/right');

// Positive command means a left turn. Positive caster should camber the inside-left
// wheel toward positive and the outside-right wheel toward negative camber.
const steerCommand = 15 * Math.PI / 180;
const flSteered = solveSuspensionKinematics(fl, 0.03, steerCommand);
const frSteered = solveSuspensionKinematics(fr, 0.03, steerCommand);
assert(flSteered.headingRad > 0, 'left command failed to steer FL left');
assert(frSteered.headingRad > 0, 'left command failed to steer FR left');
assert(flSteered.camberDeg > flBump.camberDeg, 'positive caster must add positive camber to inside-left wheel');
assert(frSteered.camberDeg < frBump.camberDeg, 'positive caster must add negative camber to outside-right wheel');

// Sweep the full configured travel and ensure the linkage never hits a numerical
// singularity or produces a discontinuous wheel pose.
let previous = solveSuspensionKinematics(fl, -0.12, 0.10);
let maxBumpSteer = Math.abs(previous.bumpSteerDeg);
for (let i = 1; i <= 52; i++) {
  const travel = -0.12 + (0.26 * i) / 52;
  const pose = solveSuspensionKinematics(fl, travel, 0.10);
  for (const value of [
    pose.hubCenterBody.x, pose.hubCenterBody.y, pose.hubCenterBody.z,
    pose.headingRad, pose.camberDeg, pose.bumpSteerDeg,
    pose.casterDeg, pose.kingpinInclinationDeg, pose.scrubRadiusM,
  ]) {
    assert(Number.isFinite(value), `non-finite kinematic result at travel=${travel}`);
  }
  assert(Math.abs(pose.camberDeg - previous.camberDeg) < 0.8, `camber discontinuity at travel=${travel}`);
  assert(Math.abs(pose.headingRad - previous.headingRad) < 0.03, `toe/heading discontinuity at travel=${travel}`);
  maxBumpSteer = Math.max(maxBumpSteer, Math.abs(pose.bumpSteerDeg));
  previous = pose;
}
assert(maxBumpSteer < 0.7, `full-travel bump steer became excessive: ${maxBumpSteer} deg`);

// The adapter receives velocities in the old scalar-steer frame and returns tire
// forces to that same frame after solving in the true kinematic wheel frame. These
// transformations must preserve vector magnitude/energy rather than inventing force.
const delta = 0.075;
const velocity = transformVelocityToKinematicFrame(22, 3.5, delta);
assertNear(Math.hypot(velocity.longitudinal, velocity.lateral), Math.hypot(22, 3.5), 1e-10, 'velocity transform changed magnitude');
const force = transformForceToCommandFrame(5100, -2800, delta);
assertNear(Math.hypot(force.longitudinal, force.lateral), Math.hypot(5100, -2800), 1e-10, 'force transform changed magnitude');

const dotFL = PhysicsMath.vec3Dot(flSteered.forwardBody, flSteered.lateralBody);
assertNear(dotFL, 0, 1e-9, 'wheel forward/lateral basis lost orthogonality');
assertNear(PhysicsMath.vec3Length(flSteered.forwardBody), 1, 1e-9, 'wheel forward basis is not normalized');
assertNear(PhysicsMath.vec3Length(flSteered.lateralBody), 1, 1e-9, 'wheel lateral basis is not normalized');
assertNear(PhysicsMath.vec3Length(flSteered.upBody), 1, 1e-9, 'wheel up basis is not normalized');

console.log(JSON.stringify({
  static: {
    camberDeg: flStatic.camberDeg,
    rollCenterHeightMm: frontRollCenterHeightM * 1000,
    casterDeg: flStatic.casterDeg,
    kingpinInclinationDeg: flStatic.kingpinInclinationDeg,
    scrubRadiusMm: flStatic.scrubRadiusM * 1000,
  },
  mildGain: {
    derivedCamberGainDegPerMeter: mildGain.derivedCamberGainDegPerMeter,
    bump50mmCamberDeltaDeg: mildBump.camberDeg - mildStatic.camberDeg,
  },
  bump50mm: {
    camberDeg: flBump.camberDeg,
    bumpSteerDeg: flBump.bumpSteerDeg,
  },
  leftSteer15Deg: {
    insideCamberDeg: flSteered.camberDeg,
    outsideCamberDeg: frSteered.camberDeg,
  },
  maxFullTravelBumpSteerDeg: maxBumpSteer,
  status: 'passed',
}, null, 2));

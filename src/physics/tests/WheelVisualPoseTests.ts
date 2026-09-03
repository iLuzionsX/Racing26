import { computeWheelVisualPose } from '../../graphics/wheelVisualPose';

const assert = (condition: boolean, message: string) => {
  if (!condition) throw new Error(message);
};
const assertNear = (actual: number, expected: number, tolerance: number, message: string) => {
  assert(Math.abs(actual - expected) <= tolerance, `${message}: ${actual} vs ${expected}`);
};

const base = {
  chassisHeaveM: 0,
  chassisPitchRad: 0,
  chassisRollRad: 0,
  mountX: -0.84,
  mountZ: 1.5,
  suspensionTravelM: 0.03,
  tireSquishM: 0.018,
  sidewallDeflectionM: 0.006,
  isLeft: true,
  camberRad: -1.5 * Math.PI / 180,
  visualWheelRadiusM: 0.33,
};

const flat = computeWheelVisualPose(base);
assertNear(flat.x, -0.846, 1e-9, 'flat wheel X changed unexpectedly');
assertNear(flat.y, 0.342, 1e-9, 'flat wheel Y changed unexpectedly');
assertNear(flat.z, 1.5, 1e-9, 'flat wheel Z changed unexpectedly');
assertNear(flat.rotationX, 0, 1e-9, 'flat wheel inherited pitch unexpectedly');

const roll = 57 * Math.PI / 180;
const pitch = 38 * Math.PI / 180;
const crashPose = computeWheelVisualPose({
  ...base,
  chassisHeaveM: 0.11,
  chassisPitchRad: pitch,
  chassisRollRad: roll,
});
assert(crashPose.crashAttachmentBlend > 0.9, '57deg wipeout did not strongly attach wheel orientation to chassis');
assert(Math.abs(crashPose.mountY) > 0.25, 'wipeout pose did not rotate suspension pickup meaningfully');
assert(Math.abs(crashPose.rotationZ) > Math.abs(base.camberRad), 'crash wheel did not inherit chassis roll');

console.log(JSON.stringify({ flat, crashPose, status: 'passed' }, null, 2));

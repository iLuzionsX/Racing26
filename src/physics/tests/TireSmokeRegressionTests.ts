import { estimateGrossTireSlide } from '../WheelDynamics';

const assert = (condition: boolean, message: string) => {
  if (!condition) throw new Error(message);
};
const deg = (value: number) => value * Math.PI / 180;
const cornerSpeed = 25;
const normalCorner = estimateGrossTireSlide(cornerSpeed, Math.tan(deg(7.7)) * cornerSpeed, cornerSpeed);
assert(normalCorner.totalSlipSpeed < 1e-9, 'normal peak cornering must not trigger smoke');
const hardCorner = estimateGrossTireSlide(cornerSpeed, Math.tan(deg(10.5)) * cornerSpeed, cornerSpeed);
assert(hardCorner.totalSlipSpeed < 1e-9, 'hard force-generating cornering must not puff tire smoke');
const drift = estimateGrossTireSlide(cornerSpeed, Math.tan(deg(18)) * cornerSpeed, cornerSpeed);
assert(drift.lateralSlipSpeed > 2.0, '18 degree drift should register gross lateral slide');
const traction = estimateGrossTireSlide(30, 0, 33.6);
assert(traction.longitudinalSlipSpeed < 1e-9, 'peak traction must not count as burnout slide');
const burnout = estimateGrossTireSlide(5, 0, 15);
assert(burnout.longitudinalSlipSpeed > 5, 'wheelspin should register gross longitudinal slide');
const locked = estimateGrossTireSlide(20, 0, 0);
assert(locked.longitudinalSlipSpeed > 10, 'locked wheel should register gross longitudinal slide');
console.log('Tire smoke regression checks passed.');

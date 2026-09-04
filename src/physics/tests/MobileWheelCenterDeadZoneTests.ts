import assert from 'node:assert/strict';
import {
  MOBILE_STEERING_WHEEL_CENTER_DEAD_FRACTION,
  MOBILE_STEERING_WHEEL_DEADZONE_DEG,
  advanceMobileWheelRotationDeg,
  isMobileWheelPointerNearCenter,
  mobileWheelPointerAngleDeg,
  mobileWheelPointerRadiusPx,
  mobileWheelRotationToSteer,
} from '../../components/mobileControls';

// Deterministic UI/input-math regression for Lane 6 center dead-radius guard.
// No physics, grip, rack or speed-cap change; validates normal-path mapping only.

// Center tap must be classified as near-center for a representative wheel size.
const wheelRadiusPx = 72;
assert.equal(MOBILE_STEERING_WHEEL_CENTER_DEAD_FRACTION, 0.24, 'dead fraction must stay deterministic');
assert.equal(MOBILE_STEERING_WHEEL_DEADZONE_DEG, 3, '3deg rim deadzone must not drift');
assert(isMobileWheelPointerNearCenter(2, wheelRadiusPx), '2px from center must be near-center');
assert(isMobileWheelPointerNearCenter(0, wheelRadiusPx), 'exact center must be near-center');
assert(!isMobileWheelPointerNearCenter(wheelRadiusPx * 0.9, wheelRadiusPx), 'rim edge must be valid');

// Radius helper is Euclidean and finite-safe.
assert(Math.abs(mobileWheelPointerRadiusPx(100, 100, 103, 104) - 5) < 1e-9, 'radius helper must be Euclidean');
assert(isMobileWheelPointerNearCenter(mobileWheelPointerRadiusPx(0, 0, 0, 0), 72), 'NaN/zero guard must default to near-center');

// Documented center pathology without guard: angle at r~0 snaps to 180deg.
const centerAngle = mobileWheelPointerAngleDeg(100, 100, 100, 100);
assert(Math.abs(Math.abs(centerAngle) - 180) < 1e-9, `center angle must be degenerate 180deg, got ${centerAngle}`);
const edgeAngle = mobileWheelPointerAngleDeg(100, 100, 101, 100);
assert(Math.abs(edgeAngle - 90) < 1e-9, `1px east of center must be 90deg, got ${edgeAngle}`);

// Guarded sequence: valid -> center excursion (held) -> resync without rim delta.
// Emulates component logic: while near-center, rotation is held and reference is resynced on exit.
let rotation = 40;
let lastValid = 10;
const guardedAdvance = (prevRotation: number, prevAngle: number, nextAngle: number, nextNearCenter: boolean, enteredFromCenter: boolean): { rotation: number; angle: number; entered: boolean; advanced: boolean } => {
  if (nextNearCenter) return { rotation: prevRotation, angle: prevAngle, entered: true, advanced: false };
  if (enteredFromCenter) return { rotation: prevRotation, angle: nextAngle, entered: false, advanced: false };
  return { rotation: advanceMobileWheelRotationDeg(prevRotation, prevAngle, nextAngle, 900), angle: nextAngle, entered: false, advanced: true };
};
let entered = false;
let step = guardedAdvance(rotation, lastValid, 180, true, entered);
assert(!step.advanced && step.rotation === 40, 'center excursion must hold rim rotation');
entered = step.entered;
step = guardedAdvance(step.rotation, step.angle, 12, false, entered);
assert(!step.advanced && step.rotation === 40 && step.angle === 12, 'exit from center must resync without injecting delta');
entered = step.entered;
step = guardedAdvance(step.rotation, step.angle, 14, false, entered);
assert(step.advanced && Math.abs(step.rotation - 42) < 1e-9, `valid 2deg drag must advance rim, got ${step.rotation}`);

// Seam and deadzone behavior preserved.
assert(Math.abs(advanceMobileWheelRotationDeg(0, 179, -179, 900) - 2) < 1e-9, 'atan2 seam +179 to -179 must be +2deg continuation');
assert(mobileWheelRotationToSteer(3, 900) === 0, '3deg rim deadzone edge must map to 0 steer');
assert(mobileWheelRotationToSteer(60, 900) < 0.14 && mobileWheelRotationToSteer(60, 900) > 0.11, '60deg hand input must stay ordinary pre-saturation steer');
assert(mobileWheelRotationToSteer(-60, 900) === -mobileWheelRotationToSteer(60, 900), 'left/right hand input must mirror');

console.log('MobileWheelCenterDeadZoneTests: PASS');

import assert from 'node:assert/strict';
import {
  MOBILE_STEERING_WHEEL_MAX_DEG,
  clampMobileWheelRotationDeg,
  mapMobileSteeringDirection,
  mobileWheelGrabOffsetDeg,
  mobileWheelPointerAngleDeg,
  mobileWheelRotationToSteer,
  mobileWheelSteerToRotationDeg,
  resolveMobileWheelRotationDeg,
  wrapAngleDeg,
} from '../../components/mobileControls';

assert.equal(mapMobileSteeringDirection('left'), 'steerLeft');
assert.equal(mapMobileSteeringDirection('right'), 'steerRight');
assert.notEqual(mapMobileSteeringDirection('left'), mapMobileSteeringDirection('right'));

assert.equal(mobileWheelPointerAngleDeg(0, 0, 0, -10), 0);
assert.equal(mobileWheelPointerAngleDeg(0, 0, 10, 0), 90);
assert.equal(mobileWheelPointerAngleDeg(0, 0, -10, 0), -90);
assert.equal(wrapAngleDeg(190), -170);
assert.equal(wrapAngleDeg(-190), 170);
assert.equal(wrapAngleDeg(360), 0);

assert.equal(mobileWheelGrabOffsetDeg(45, 0), 45);
assert.equal(resolveMobileWheelRotationDeg(45, 45), 0);
assert.equal(resolveMobileWheelRotationDeg(180, 0), MOBILE_STEERING_WHEEL_MAX_DEG);
assert.equal(clampMobileWheelRotationDeg(999), MOBILE_STEERING_WHEEL_MAX_DEG);
assert.equal(clampMobileWheelRotationDeg(-999), -MOBILE_STEERING_WHEEL_MAX_DEG);

assert.equal(mobileWheelRotationToSteer(-MOBILE_STEERING_WHEEL_MAX_DEG), 1, 'CCW/full-left must be +1');
assert.equal(mobileWheelRotationToSteer(MOBILE_STEERING_WHEEL_MAX_DEG), -1, 'CW/full-right must be -1');
assert.equal(mobileWheelRotationToSteer(0), 0);
assert.equal(mobileWheelRotationToSteer(2), 0);
assert.equal(mobileWheelRotationToSteer(-2), 0);
assert.ok(Math.abs(mobileWheelRotationToSteer(-67.5) + mobileWheelRotationToSteer(67.5)) < 1e-12);
assert.equal(mobileWheelSteerToRotationDeg(1), -MOBILE_STEERING_WHEEL_MAX_DEG);
assert.equal(mobileWheelSteerToRotationDeg(-1), MOBILE_STEERING_WHEEL_MAX_DEG);

console.log('MobileControlsTests: PASS');

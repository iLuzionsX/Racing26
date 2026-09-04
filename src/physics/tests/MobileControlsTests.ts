import assert from 'node:assert/strict';
import {
  MOBILE_STEERING_ROTATION_STORAGE_KEY,
  MOBILE_STEERING_WHEEL_DEFAULT_ROTATION_DEG,
  MOBILE_STEERING_WHEEL_MAX_DEG,
  MOBILE_STEERING_WHEEL_MAX_ROTATION_DEG,
  MOBILE_STEERING_WHEEL_MIN_ROTATION_DEG,
  advanceMobileWheelRotationDeg,
  clampMobileWheelRotationDeg,
  loadMobileSteeringRotationDeg,
  mapMobileSteeringDirection,
  mobileWheelGrabOffsetDeg,
  mobileWheelMaxRotationDeg,
  mobileWheelPointerAngleDeg,
  mobileWheelRotationToSteer,
  mobileWheelSteerToRotationDeg,
  resolveMobileWheelRotationDeg,
  sanitizeMobileSteeringRotationDeg,
  saveMobileSteeringRotationDeg,
  wrapAngleDeg,
} from '../../components/mobileControls';
import {
  DEFAULT_MOBILE_CONTROL_LAYOUT,
  MOBILE_CONTROL_LAYOUT_STORAGE_KEY,
  clampMobileClusterCenter,
  cloneMobileControlLayoutStore,
  loadMobileControlLayoutStore,
  mobileControlOrientationForViewport,
  parseMobileControlLayoutStore,
  resolveMobileClusterDrag,
  saveMobileControlLayoutStore,
  sanitizeMobileControlLayoutStore,
  updateMobileControlCluster,
  type StorageLike,
} from '../../components/mobileControlLayout';

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
assert.equal(resolveMobileWheelRotationDeg(180, 0), 180);
assert.equal(clampMobileWheelRotationDeg(999), MOBILE_STEERING_WHEEL_MAX_DEG);
assert.equal(clampMobileWheelRotationDeg(-999), -MOBILE_STEERING_WHEEL_MAX_DEG);

assert.equal(mobileWheelRotationToSteer(-MOBILE_STEERING_WHEEL_MAX_DEG), 1, 'CCW/full-left must be +1');
assert.equal(mobileWheelRotationToSteer(MOBILE_STEERING_WHEEL_MAX_DEG), -1, 'CW/full-right must be -1');
assert.equal(mobileWheelRotationToSteer(0), 0);
assert.equal(mobileWheelRotationToSteer(2), 0);
assert.equal(mobileWheelRotationToSteer(-2), 0);
assert.ok(Math.abs(mobileWheelRotationToSteer(-67.5) + mobileWheelRotationToSteer(67.5)) < 1e-12);

// Default 900-degree lock-to-lock travel should approximate the M5's published
// 14.2:1 steering ratio against the simulator's 0.58 rad center road-wheel lock.
assert.equal(MOBILE_STEERING_WHEEL_DEFAULT_ROTATION_DEG, 900);
assert.equal(mobileWheelMaxRotationDeg(), 450);
const m5RoadWheelLockDeg = 0.58 * 180 / Math.PI;
const effectiveSteeringRatio = MOBILE_STEERING_WHEEL_MAX_DEG / m5RoadWheelLockDeg;
assert(
  effectiveSteeringRatio > 13.0 && effectiveSteeringRatio < 15.0,
  `default mobile steering ratio should approximate M5 14.2:1, got ${effectiveSteeringRatio.toFixed(2)}:1`
);
const sixtyDegreeSteer = Math.abs(mobileWheelRotationToSteer(60));
assert(
  sixtyDegreeSteer > 0.11 && sixtyDegreeSteer < 0.14,
  `60deg hand-wheel input should remain a fine steering request, got ${sixtyDegreeSteer.toFixed(3)}`
);
assert.equal(mobileWheelRotationToSteer(-270, 540), 1, 'custom 540deg rotation must retain full-left rack');
assert.equal(mobileWheelRotationToSteer(270, 540), -1, 'custom 540deg rotation must retain full-right rack');
assert.equal(mobileWheelSteerToRotationDeg(1), -MOBILE_STEERING_WHEEL_MAX_DEG);
assert.equal(mobileWheelSteerToRotationDeg(-1), MOBILE_STEERING_WHEEL_MAX_DEG);


assert.equal(
  advanceMobileWheelRotationDeg(30, 179, -179),
  32,
  'Crossing the atan2 +180/-180 seam must continue smoothly.'
);
assert.equal(
  advanceMobileWheelRotationDeg(-30, -179, 179),
  -32,
  'Reverse seam crossing must remain mirrored.'
);
assert.equal(
  advanceMobileWheelRotationDeg(MOBILE_STEERING_WHEEL_MAX_DEG - 4, 10, 30),
  MOBILE_STEERING_WHEEL_MAX_DEG,
  'Incremental wheel motion must clamp at full lock without wrapping.'
);

assert.equal(mobileControlOrientationForViewport(844, 390), 'landscape');
assert.equal(mobileControlOrientationForViewport(390, 844), 'portrait');

const defaults = cloneMobileControlLayoutStore(DEFAULT_MOBILE_CONTROL_LAYOUT);
assert.ok(defaults.landscape.wheel.x < defaults.portrait.wheel.x);
assert.ok(defaults.landscape.pedals.x > defaults.landscape.wheel.x);

const malformed = parseMobileControlLayoutStore('{bad json');
assert.deepEqual(malformed, DEFAULT_MOBILE_CONTROL_LAYOUT);

const sanitized = sanitizeMobileControlLayoutStore({
  version: 1,
  portrait: {
    wheel: { x: -20, y: 99, scale: 9 },
    pedals: { x: Number.NaN, y: 0.4, scale: 0.01 },
  },
  landscape: {
    wheel: { x: 0.2, y: 0.7, scale: 1.1 },
    pedals: { x: 0.8, y: 0.75, scale: 1.2 },
  },
});
assert.equal(sanitized.portrait.wheel.x, 0);
assert.equal(sanitized.portrait.wheel.y, 1);
assert.equal(sanitized.portrait.wheel.scale, 1.5);
assert.equal(sanitized.portrait.pedals.x, DEFAULT_MOBILE_CONTROL_LAYOUT.portrait.pedals.x);
assert.equal(sanitized.portrait.pedals.scale, 0.7);

const resized = updateMobileControlCluster(defaults.landscape, 'wheel', { scale: 1.35 });
assert.equal(resized.wheel.scale, 1.35);
assert.equal(resized.pedals.scale, defaults.landscape.pedals.scale);

const safeClamped = clampMobileClusterCenter(
  { x: 0, y: 1 },
  { width: 390, height: 844 },
  { width: 120, height: 120 },
  { left: 20, right: 0, top: 47, bottom: 34 }
);
assert.ok(safeClamped.x > 0.2, 'wheel center must clear left safe area plus half-width');
assert.ok(safeClamped.y < 0.9, 'wheel center must clear bottom safe area plus half-height');

const dragged = resolveMobileClusterDrag(
  { x: 0.5, y: 0.5 },
  -1000,
  1000,
  { width: 390, height: 844 },
  { width: 120, height: 120 },
  { left: 20, right: 0, top: 47, bottom: 34 }
);
assert.ok(dragged.x > 0);
assert.ok(dragged.y < 1);

const storageMap = new Map<string, string>();
const memoryStorage: StorageLike = {
  getItem: (key) => storageMap.get(key) ?? null,
  setItem: (key, value) => {
    storageMap.set(key, value);
  },
  removeItem: (key) => {
    storageMap.delete(key);
  },
};
saveMobileControlLayoutStore(sanitized, memoryStorage);
assert.ok(storageMap.has(MOBILE_CONTROL_LAYOUT_STORAGE_KEY));
assert.deepEqual(loadMobileControlLayoutStore(memoryStorage), sanitized);

assert.equal(sanitizeMobileSteeringRotationDeg(100), MOBILE_STEERING_WHEEL_MIN_ROTATION_DEG);
assert.equal(sanitizeMobileSteeringRotationDeg(2000), MOBILE_STEERING_WHEEL_MAX_ROTATION_DEG);
assert.equal(sanitizeMobileSteeringRotationDeg(Number.NaN), MOBILE_STEERING_WHEEL_DEFAULT_ROTATION_DEG);
assert.equal(loadMobileSteeringRotationDeg(memoryStorage), MOBILE_STEERING_WHEEL_DEFAULT_ROTATION_DEG);
assert.equal(saveMobileSteeringRotationDeg(720, memoryStorage), 720);
assert.equal(storageMap.get(MOBILE_STEERING_ROTATION_STORAGE_KEY), '720');
assert.equal(loadMobileSteeringRotationDeg(memoryStorage), 720);

console.log('MobileControlsTests: PASS');

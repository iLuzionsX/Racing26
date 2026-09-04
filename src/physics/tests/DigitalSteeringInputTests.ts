import assert from 'node:assert/strict';
import {
  digitalCountersteerRecoveryBlend,
  digitalSteeringLimitForSpeed,
  digitalSteeringTarget,
  updateDigitalSteeringInput,
  type DigitalSteeringContext,
} from '../DigitalSteeringInput';

const DT = 1 / 120;
const WHEELBASE_M = 3.00482;
const MAX_STEER_RAD = 0.58;
const BASE_CONTEXT: DigitalSteeringContext = {
  wheelbaseM: WHEELBASE_M,
  maxSteerAngleRad: MAX_STEER_RAD,
  forwardSpeedMs: 0,
};

function hold(
  direction: -1 | 0 | 1,
  speedKmh: number,
  durationSec: number,
  start = 0,
  context: DigitalSteeringContext = {}
) {
  let input = start;
  const speedMs = speedKmh / 3.6;
  const steps = Math.round(durationSec / DT);
  for (let i = 0; i < steps; i++) {
    input = updateDigitalSteeringInput(input, direction, speedMs, DT, {
      ...BASE_CONTEXT,
      forwardSpeedMs: speedMs,
      ...context,
    });
  }
  return input;
}

function impliedLateralG(speedKmh: number, normalizedSteer: number) {
  const speedMs = speedKmh / 3.6;
  const roadWheelAngle = Math.abs(normalizedSteer) * MAX_STEER_RAD;
  return (speedMs * speedMs * Math.tan(roadWheelAngle) / WHEELBASE_M) / 9.81;
}

// Parking/crawl keeps the full mechanical rack available to digital users.
const parkingLeft = hold(1, 6, 1.0);
const parkingRight = hold(-1, 6, 1.0);
assert(Math.abs(parkingLeft - 1) < 1e-12, '6 km/h left hold must reach full parking authority');
assert(Math.abs(parkingRight + 1) < 1e-12, '6 km/h right hold must reach full parking authority');

// Normal road-speed steering is a sustained soft envelope, not merely a slower
// journey to full parking-lot lock.
for (const speedKmh of [40, 70, 100, 120]) {
  const left = hold(1, speedKmh, 2.0);
  const right = hold(-1, speedKmh, 2.0);
  const expectedLimit = digitalSteeringLimitForSpeed(speedKmh / 3.6, {
    ...BASE_CONTEXT,
    forwardSpeedMs: speedKmh / 3.6,
  });

  assert(Math.abs(left - expectedLimit) < 1e-9, `${speedKmh} km/h left hold must settle at the soft limit`);
  assert(Math.abs(right + expectedLimit) < 1e-9, `${speedKmh} km/h right hold must settle at the mirrored soft limit`);
  assert(Math.abs(left + right) < 1e-12, `${speedKmh} km/h left/right must mirror exactly`);
  assert(Math.abs(left) < 0.8, `${speedKmh} km/h normal steering must not approach parking lock`);

  if (speedKmh >= 70) {
    assert(
      impliedLateralG(speedKmh, left) <= 0.90,
      `${speedKmh} km/h envelope should stay near/below the 0.88g design target, got ${impliedLateralG(speedKmh, left).toFixed(3)}g`
    );
  }
}

const limit40 = digitalSteeringLimitForSpeed(40 / 3.6, BASE_CONTEXT);
const limit70 = digitalSteeringLimitForSpeed(70 / 3.6, BASE_CONTEXT);
const limit100 = digitalSteeringLimitForSpeed(100 / 3.6, BASE_CONTEXT);
const limit120 = digitalSteeringLimitForSpeed(120 / 3.6, BASE_CONTEXT);
assert(limit40 > limit70 && limit70 > limit100 && limit100 > limit120, 'road-speed envelope must tighten monotonically');

// High-speed taps remain responsive, but cannot inject a huge tire-saturating
// steering command in one frame or one short key press.
const highTap = hold(1, 100, 0.10);
assert(highTap > 0.02, `100 km/h tap must still steer, got ${highTap}`);
assert(highTap <= limit100 + 1e-12, `100 km/h tap must remain inside the soft limit, got ${highTap}`);

// Release is intentionally fast at every representative speed.
for (const speedKmh of [6, 40, 70, 100, 120]) {
  const start = hold(1, speedKmh, 1.0);
  const released = hold(0, speedKmh, 0.25, start);
  assert(Math.abs(released) < 1e-12, `release must center at ${speedKmh} km/h, got ${released}`);
}

// A normal direction change in a chicane does not unlock emergency full rack
// merely because yaw has not reversed yet. Mild sideslip stays inside the soft limit.
const chicaneContext: DigitalSteeringContext = {
  ...BASE_CONTEXT,
  forwardSpeedMs: 100 / 3.6,
  yawRateRadS: 0.35,
  sideslipRad: -2.0 * Math.PI / 180,
};
assert(
  digitalCountersteerRecoveryBlend(-1, 100 / 3.6, chicaneContext) === 0,
  'mild chicane transient must not be classified as oversteer recovery'
);
const chicaneTarget = digitalSteeringTarget(-1, 100 / 3.6, chicaneContext);
assert(Math.abs(chicaneTarget) <= limit100 + 1e-12, 'ordinary chicane target must respect the road-speed envelope');

// Recovery onset must be continuous. A phase-lag state just beyond both
// detection thresholds is plausible during an S-bend; it may add a little
// opposite-lock confidence but must never jump directly to a fixed half-rack.
const onsetLeft: DigitalSteeringContext = {
  ...BASE_CONTEXT,
  forwardSpeedMs: 100 / 3.6,
  yawRateRadS: 0.30,
  sideslipRad: -4.5 * Math.PI / 180,
};
const onsetRight: DigitalSteeringContext = {
  ...BASE_CONTEXT,
  forwardSpeedMs: 100 / 3.6,
  yawRateRadS: -0.30,
  sideslipRad: 4.5 * Math.PI / 180,
};
const onsetBlendLeft = digitalCountersteerRecoveryBlend(-1, 100 / 3.6, onsetLeft);
const onsetBlendRight = digitalCountersteerRecoveryBlend(1, 100 / 3.6, onsetRight);
const onsetTargetLeft = digitalSteeringTarget(-1, 100 / 3.6, onsetLeft);
const onsetTargetRight = digitalSteeringTarget(1, 100 / 3.6, onsetRight);
assert(onsetBlendLeft > 0 && onsetBlendLeft < 0.10, `threshold-onset recovery confidence should stay small, got ${onsetBlendLeft}`);
assert(Math.abs(onsetBlendLeft - onsetBlendRight) < 1e-12, 'threshold-onset blend must mirror exactly');
assert(
  Math.abs(onsetTargetLeft) - limit100 < 0.10,
  `threshold-onset target must remain near the road-speed envelope, got ${Math.abs(onsetTargetLeft)} vs ${limit100}`
);
assert(Math.abs(onsetTargetLeft + onsetTargetRight) < 1e-12, 'threshold-onset target must mirror exactly');

// The slew path must be continuous too: a tiny recovery confidence cannot switch
// a normal reversal instantly onto the full 8.5/s emergency slew.
const reversalStart = limit100;
const onsetStep = updateDigitalSteeringInput(
  reversalStart,
  -1,
  100 / 3.6,
  DT,
  onsetLeft
);
assert(
  Math.abs(onsetStep - reversalStart) <= 7.2 * DT,
  `threshold-onset reversal slew jumped too far in one frame: ${onsetStep - reversalStart}`
);

// Genuine left-oversteer: car is yawing left (+yaw), velocity is slipping right
// relative to the body (negative beta), and the driver requests right countersteer.
const recoveryContext: DigitalSteeringContext = {
  ...BASE_CONTEXT,
  forwardSpeedMs: 100 / 3.6,
  yawRateRadS: 0.72,
  sideslipRad: -10.0 * Math.PI / 180,
};
const recoveryBlend = digitalCountersteerRecoveryBlend(-1, 100 / 3.6, recoveryContext);
const recoveryTarget = digitalSteeringTarget(-1, 100 / 3.6, recoveryContext);
assert(recoveryBlend > 0.35, `genuine oversteer should unlock recovery authority, blend=${recoveryBlend}`);
assert(Math.abs(recoveryTarget) > Math.max(0.45, limit100 * 4), `recovery target should substantially exceed normal limit: ${recoveryTarget}`);
assert(Math.abs(recoveryTarget) <= 1, 'recovery target must remain inside mechanical rack authority');

let recovery = 0.10;
recovery = hold(-1, 100, 0.10, recovery, recoveryContext);
assert(recovery < -0.35, `100 ms recovery countersteer should cross center decisively, got ${recovery}`);
recovery = hold(-1, 100, 0.18, recovery, recoveryContext);
assert(recovery <= recoveryTarget + 1e-9, 'recovery command must not exceed its computed mechanical authority');

// Severe slide approaches full opposite lock, preserving the authority that the
// old speed limiter accidentally removed.
const severeRecoveryContext: DigitalSteeringContext = {
  ...BASE_CONTEXT,
  forwardSpeedMs: 90 / 3.6,
  yawRateRadS: 1.05,
  sideslipRad: -18.0 * Math.PI / 180,
};
const severeTarget = digitalSteeringTarget(-1, 90 / 3.6, severeRecoveryContext);
assert(severeTarget < -0.95, `severe oversteer must restore near-full opposite lock, got ${severeTarget}`);

// Mirror the severe recovery case exactly.
const severeMirror: DigitalSteeringContext = {
  ...BASE_CONTEXT,
  forwardSpeedMs: 90 / 3.6,
  yawRateRadS: -1.05,
  sideslipRad: 18.0 * Math.PI / 180,
};
const severeMirrorTarget = digitalSteeringTarget(1, 90 / 3.6, severeMirror);
assert(Math.abs(severeTarget + severeMirrorTarget) < 1e-12, 'recovery authority must mirror exactly left/right');

// Recovery is disabled in reverse to avoid applying forward-travel slip semantics.
const reverseContext: DigitalSteeringContext = {
  ...severeRecoveryContext,
  forwardSpeedMs: -90 / 3.6,
};
assert(
  digitalCountersteerRecoveryBlend(-1, 90 / 3.6, reverseContext) === 0,
  'forward oversteer heuristic must not activate while reversing'
);

// dt=0 remains a pure clamp and cannot advance steering state.
assert(updateDigitalSteeringInput(1.2, 1, 100 / 3.6, 0) === 1, 'dt=0 must clamp only');

console.log('DigitalSteeringInputTests: PASS');

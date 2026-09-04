import assert from 'node:assert/strict';
import { digitalCountersteerRecoveryBlend, digitalSteeringLimitForSpeed, digitalSteeringTarget } from '../DigitalSteeringInput';
const DEG = Math.PI / 180;
const WHEELBASE_M = 3.00482;
const MAX_STEER_RAD = 0.58;
const SPEED_MS = 100 / 3.6;
function ctx(betaDeg: number, yawRadS: number, forwardMs: number = SPEED_MS) {
  return { wheelbaseM: WHEELBASE_M, maxSteerAngleRad: MAX_STEER_RAD, yawRateRadS: yawRadS, sideslipRad: betaDeg * DEG, forwardSpeedMs: forwardMs };
}
function blendFor(dir: -1 | 1, betaDeg: number, yawRadS: number) {
  return digitalCountersteerRecoveryBlend(dir, SPEED_MS, ctx(betaDeg, yawRadS));
}
assert.equal(blendFor(-1, -3.9, 0.24), 0, 'sub-threshold left must stay zero');
assert.equal(blendFor(1, 3.9, -0.24), 0, 'sub-threshold right must stay zero');
assert.equal(blendFor(-1, -2.0, 0.35), 0, 'mild chicane must not classify as recovery');
assert.equal(blendFor(1, 2.0, -0.35), 0, 'mirrored mild chicane must not classify');
const justLeft = blendFor(-1, -4.5, 0.30);
const justRight = blendFor(1, 4.5, -0.30);
assert(justLeft > 0 && justLeft < 0.10, 'entry blend must be small confidence only');
assert(Math.abs(justLeft - justRight) < 1e-12, 'entry blend must mirror exactly');
const midLeft = blendFor(-1, -8.0, 0.50);
const midRight = blendFor(1, 8.0, -0.50);
assert(midLeft > 0.10 && midLeft < 0.75, 'mid blend must be partial');
assert(Math.abs(midLeft - midRight) < 1e-12, 'mid blend must mirror exactly');
const fullLeft = blendFor(-1, -14.0, 0.85);
const fullRight = blendFor(1, 14.0, -0.85);
assert(fullLeft > 0.95, 'full threshold must approach one');
assert(Math.abs(fullLeft - fullRight) < 1e-12, 'full blend must mirror exactly');
assert.equal(blendFor(-1, -18.0, 1.05), 1, 'beyond full must saturate at one');
assert.equal(blendFor(1, 18.0, -1.05), 1, 'mirrored beyond full must saturate');
assert.equal(digitalCountersteerRecoveryBlend(1, SPEED_MS, ctx(-10.0, 0.72)), 0, 'same-direction must stay zero');
assert.equal(digitalCountersteerRecoveryBlend(-1, SPEED_MS, ctx(10.0, -0.72)), 0, 'mirrored same-direction must stay zero');
const normalLimit = digitalSteeringLimitForSpeed(SPEED_MS, ctx(0, 0));
const chicaneTarget = Math.abs(digitalSteeringTarget(-1, SPEED_MS, ctx(-5.0, 0.35)));
const chicaneMirror = Math.abs(digitalSteeringTarget(1, SPEED_MS, ctx(5.0, -0.35)));
assert(chicaneTarget - normalLimit < 0.12, 'chicane must stay near envelope without bypass');
assert(Math.abs(chicaneTarget - chicaneMirror) < 1e-12, 'chicane target must mirror exactly');
const severeTarget = digitalSteeringTarget(-1, SPEED_MS, ctx(-18.0, 1.05));
const severeMirror = digitalSteeringTarget(1, SPEED_MS, ctx(18.0, -1.05));
assert(severeTarget < -0.95, 'severe left oversteer must restore near-full lock');
assert(Math.abs(severeTarget + severeMirror) < 1e-12, 'severe recovery must mirror exactly');
assert.equal(digitalCountersteerRecoveryBlend(-1, SPEED_MS, ctx(-14.0, 0.85, -SPEED_MS)), 0, 'reverse must disable recovery');
assert.equal(digitalCountersteerRecoveryBlend(1, SPEED_MS, ctx(14.0, -0.85, -SPEED_MS)), 0, 'mirrored reverse must disable');
assert.equal(digitalCountersteerRecoveryBlend(-1, 5.0, ctx(-14.0, 0.85, 5.0)), 0, 'crawl speed must disable recovery');
assert.equal(digitalCountersteerRecoveryBlend(1, 5.0, ctx(14.0, -0.85, 5.0)), 0, 'mirrored crawl must disable');
console.log('DigitalCountersteerThresholdTests: PASS');

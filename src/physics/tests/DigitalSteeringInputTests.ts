import assert from 'node:assert/strict';
import { digitalSteerWindRatePerSecond, updateDigitalSteeringInput } from '../DigitalSteeringInput';

const DT = 1 / 120;

function hold(direction: -1 | 0 | 1, speedKmh: number, durationSec: number, start = 0) {
  let input = start;
  const steps = Math.round(durationSec / DT);
  for (let i = 0; i < steps; i++) {
    input = updateDigitalSteeringInput(input, direction, speedKmh / 3.6, DT);
  }
  return input;
}

const parkingLeft = hold(1, 6, 1.0);
const roadLeft = hold(1, 100, 1.0);
const roadRight = hold(-1, 100, 1.0);

assert(Math.abs(parkingLeft - 1) < 1e-12, 'parking steering must reach full driver authority');
assert(Math.abs(roadLeft - 1) < 1e-12, '100 km/h held left must retain full driver authority');
assert(Math.abs(roadRight + 1) < 1e-12, '100 km/h held right must retain full driver authority');
assert(Math.abs(roadLeft + roadRight) < 1e-12, 'left/right digital steering must mirror exactly');

// A binary key is rate-limited rather than teleported. It should still reach
// meaningful opposite-lock quickly enough for a driver to catch oversteer.
let reversal = 0.25;
reversal = hold(-1, 90, 0.10, reversal);
assert(reversal < -0.25, `100 ms countersteer reversal is too slow: ${reversal.toFixed(3)}`);
reversal = hold(-1, 90, 0.20, reversal);
assert(reversal < -0.95, `300 ms total countersteer must reach near-full command: ${reversal.toFixed(3)}`);

const released = hold(0, 90, 0.25, reversal);
assert(Math.abs(released) < 1e-12, 'released digital steering must return to center');

// High-speed step-steer envelope: same maneuver mirrored left/right.
// At ~150 km/h a 150 ms binary hold must not already be at ~3/4 lock.
// Legacy constant 4.8/s gives ~0.72 and fails this; speed-sensitive wind-in gives ~0.29.
const highLeft150ms = hold(1, 150, 0.15, 0);
const highRight150ms = hold(-1, 150, 0.15, 0);
assert(highLeft150ms < 0.55, `150 km/h 150 ms turn-in still injects near-step steer: ${highLeft150ms.toFixed(3)}`);
assert(Math.abs(highLeft150ms + highRight150ms) < 1e-12, 'high-speed digital envelope must mirror exactly left/right');

// Authority preservation: a sustained 1.0 s hold at 100-180 km/h must still reach full request.
const highLeftHeld = hold(1, 150, 1.0, 0);
const highRightHeld = hold(-1, 180, 1.0, 0);
assert(Math.abs(highLeftHeld - 1) < 1e-12, 'high-speed envelope must not cap eventual driver authority');
assert(Math.abs(highRightHeld + 1) < 1e-12, 'high-speed envelope must not cap eventual driver authority mirrored');

// Recovery preservation: reversal through center stays fast at speed.
let highReversal = 0.25;
highReversal = hold(-1, 150, 0.10, highReversal);
assert(highReversal < -0.25, `high-speed countersteer reversal became too slow: ${highReversal.toFixed(3)}`);

// Rate helper itself must be symmetric, bounded, and slower at speed.
assert(digitalSteerWindRatePerSecond(41.6667) < digitalSteerWindRatePerSecond(0), 'wind rate must slow with speed');
assert.equal(digitalSteerWindRatePerSecond(27.78), digitalSteerWindRatePerSecond(-27.78), 'wind rate must be symmetric in travel direction');

console.log('DigitalSteeringInputTests: PASS');

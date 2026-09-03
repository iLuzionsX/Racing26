import assert from 'node:assert/strict';
import { updateDigitalSteeringInput } from '../DigitalSteeringInput';

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

console.log('DigitalSteeringInputTests: PASS');

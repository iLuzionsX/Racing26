import assert from 'node:assert/strict';
import { digitalWindOnRatePerSecond, updateDigitalSteeringInput } from '../DigitalSteeringInput';

const DT = 1 / 120;

function hold(direction: -1 | 0 | 1, speedKmh: number, durationSec: number, start = 0) {
  let input = start;
  const steps = Math.round(durationSec / DT);
  for (let i = 0; i < steps; i++) {
    input = updateDigitalSteeringInput(input, direction, speedKmh / 3.6, DT);
  }
  return input;
}

// Representative binary-steering speeds: parking/urban, medium showcase corner
// entry, and high-speed straight/corner entry. Mirrored left/right cases use
// identical magnitudes per PHYSICS_CONVENTIONS.md (+X left, +steer left).
const LOW_KMH = 6;
const MED_KMH = 50;
const HIGH_KMH = 100;

const parkingLeft = hold(1, 6, 1.0);
const roadLeft = hold(1, 100, 1.0);
const roadRight = hold(-1, 100, 1.0);

assert(Math.abs(parkingLeft - 1) < 1e-12, 'parking steering must reach full driver authority');
assert(Math.abs(roadLeft - 1) < 1e-12, '100 km/h held left must retain full driver authority');
assert(Math.abs(roadRight + 1) < 1e-12, '100 km/h held right must retain full driver authority');
assert(Math.abs(roadLeft + roadRight) < 1e-12, 'left/right digital steering must mirror exactly');

// Wind-on rate must fall with road speed so a brief tap gives fine control at
// speed instead of teleporting toward saturation, while a held key still
// reaches full request. Check partial-hold ordering at fixed short duration.
const lowPartial = hold(1, LOW_KMH, 0.12, 0);
const medPartial = hold(1, MED_KMH, 0.12, 0);
const highPartial = hold(1, HIGH_KMH, 0.12, 0);
assert(lowPartial > medPartial, `wind-on must slow from low to medium: ${lowPartial} vs ${medPartial}`);
assert(medPartial > highPartial, `wind-on must slow from medium to high: ${medPartial} vs ${highPartial}`);
assert(highPartial > 0.05, `high-speed tap must still steer: ${highPartial}`);
assert(lowPartial < 1, '0.12 s parking tap must not already be at full lock');

// Wind-on helper itself must be symmetric in travel direction (uses |v|) and
// monotonically non-increasing with speed, with a bounded minimum so full
// lock remains reachable on sustained hold.
assert(digitalWindOnRatePerSecond(13.8889) === digitalWindOnRatePerSecond(-13.8889), 'wind-on rate must use speed magnitude');
assert(digitalWindOnRatePerSecond(0) > digitalWindOnRatePerSecond(13.8889), 'wind-on rate must fall with speed');
assert(digitalWindOnRatePerSecond(13.8889) > digitalWindOnRatePerSecond(27.7778), 'wind-on rate must fall from medium to high');
assert(digitalWindOnRatePerSecond(60) >= 1.0, 'wind-on rate must retain >=1/s for sustained full lock');

// Left/right symmetry at each representative speed: same magnitude, opposite sign.
for (const speedKmh of [LOW_KMH, MED_KMH, HIGH_KMH]) {
  const left = hold(1, speedKmh, 0.35, 0);
  const right = hold(-1, speedKmh, 0.35, 0);
  assert(Math.abs(left + right) < 1e-12, `left/right must mirror at ${speedKmh} km/h: ${left} vs ${right}`);
  const heldLeft = hold(1, speedKmh, 1.0, 0);
  const heldRight = hold(-1, speedKmh, 1.0, 0);
  assert(Math.abs(heldLeft - 1) < 1e-12, `${speedKmh} km/h held left must retain full authority`);
  assert(Math.abs(heldRight + 1) < 1e-12, `${speedKmh} km/h held right must retain full authority`);
}

// Release must be fast at every speed (no stuck steering).
for (const speedKmh of [LOW_KMH, MED_KMH, HIGH_KMH]) {
  for (const start of [1, -1]) {
    const released = hold(0, speedKmh, 0.25, start);
    assert(Math.abs(released) < 1e-12, `release from ${start} must center at ${speedKmh} km/h, got ${released}`);
  }
}

// Countersteer/reversal authority must stay fast at every speed and exceed
// same-sign wind-on rate: driver can yank back through center to catch a slide.
for (const speedKmh of [LOW_KMH, MED_KMH, HIGH_KMH]) {
  const windOn = hold(1, speedKmh, 0.10, 0);
  const reversal = hold(-1, speedKmh, 0.10, 0.25);
  const reversalDelta = Math.abs(reversal - 0.25);
  assert(reversalDelta > Math.abs(windOn) * 2.5, `reversal must stay fast at ${speedKmh} km/h: reversalDelta=${reversalDelta} windOn=${windOn}`);
  assert(reversal < -0.25, `100 ms countersteer reversal too slow at ${speedKmh} km/h: ${reversal}`);
}

// Original oversteer-catch spot checks (90 km/h path used by M5 recovery test).
let reversal = 0.25;
reversal = hold(-1, 90, 0.10, reversal);
assert(reversal < -0.25, `100 ms countersteer reversal is too slow: ${reversal.toFixed(3)}`);
reversal = hold(-1, 90, 0.20, reversal);
assert(reversal < -0.95, `300 ms total countersteer must reach near-full command: ${reversal.toFixed(3)}`);

const released = hold(0, 90, 0.25, reversal);
assert(Math.abs(released) < 1e-12, 'released digital steering must return to center');

console.log('DigitalSteeringInputTests: PASS');

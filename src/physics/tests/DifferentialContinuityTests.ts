import assert from 'node:assert/strict';
import { DifferentialSystem } from '../Differential';

function makeM5ActiveRearDiff() {
  return new DifferentialSystem({
    type: 'TORQUE_VECTOR',
    powerRamp: 0.88,
    coastRamp: 0.48,
    preloadTorque: 100,
    drivetrain: 'RWD',
  });
}

function rearTorques(inputTorque: number, leftOmega: number, rightOmega: number) {
  const diff = makeM5ActiveRearDiff();
  const result = diff.distributeTorque(inputTorque, [0, 0, leftOmega, rightOmega]);
  return {
    left: result.wheelTorques[2],
    right: result.wheelTorques[3],
  };
}

function assertConserves(inputTorque: number, pair: { left: number; right: number }) {
  assert(
    Math.abs(pair.left + pair.right - inputTorque) < 1e-9,
    `differential failed torque conservation: input=${inputTorque}, left=${pair.left}, right=${pair.right}`
  );
}

// The active M differential must not briefly command reverse torque at one driven
// wheel during ordinary positive-power throttle tip-in. The old conditional cap
// allowed this below ~200 Nm, then snapped to same-sign torque above the threshold.
for (const torque of [5, 20, 50, 100, 150, 199.9, 200, 200.1, 250, 400]) {
  const pair = rearTorques(torque, 25, 15);
  assertConserves(torque, pair);
  assert(
    pair.left >= -1e-9 && pair.right >= -1e-9,
    `positive drive torque reversed a wheel at ${torque} Nm: left=${pair.left}, right=${pair.right}`
  );
}

// Reverse-power operation must mirror sign exactly.
for (const torque of [20, 100, 199.9, 200.1, 400]) {
  const forward = rearTorques(torque, 25, 15);
  const reverse = rearTorques(-torque, -25, -15);
  assert(
    Math.abs(forward.left + reverse.left) < 1e-9 &&
      Math.abs(forward.right + reverse.right) < 1e-9,
    `forward/reverse power mirror failed at ${torque} Nm`
  );
}

// Swapping left/right wheel speeds must only swap the output torques.
for (const torque of [50, 150, 200, 350]) {
  const leftFast = rearTorques(torque, 25, 15);
  const rightFast = rearTorques(torque, 15, 25);
  assert(
    Math.abs(leftFast.left - rightFast.right) < 1e-9 &&
      Math.abs(leftFast.right - rightFast.left) < 1e-9,
    `left/right differential mirror failed at ${torque} Nm`
  );
}

// Guard the exact historical discontinuity. Across +/-0.1 Nm around 200 Nm the
// wheel torques should move smoothly by a fraction of a Nm, not jump by ~47 Nm.
const below = rearTorques(199.9, 25, 15);
const at = rearTorques(200.0, 25, 15);
const above = rearTorques(200.1, 25, 15);
const maxAdjacentJump = Math.max(
  Math.abs(at.left - below.left),
  Math.abs(at.right - below.right),
  Math.abs(above.left - at.left),
  Math.abs(above.right - at.right)
);
assert(
  maxAdjacentJump < 0.5,
  `active-diff torque cap is discontinuous around 200 Nm: max adjacent jump=${maxAdjacentJump.toFixed(3)} Nm`
);

// Zero input remains genuinely neutral for the active unit despite wheel-speed
// difference: it must never invent equal-and-opposite axle torque.
const zero = rearTorques(0, 25, 15);
assert(Math.abs(zero.left) < 1e-12 && Math.abs(zero.right) < 1e-12, 'active diff injected torque at zero input');

console.log(JSON.stringify({
  scenario: 'M5 active differential throttle-tip-in continuity',
  around200Nm: { below, at, above, maxAdjacentJump },
}, null, 2));
console.log('DifferentialContinuityTests: PASS');

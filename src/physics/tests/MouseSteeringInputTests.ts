import assert from 'node:assert/strict';
import { mouseSteeringFromClientX } from '../MouseSteeringInput';

const left = mouseSteeringFromClientX(0, 0, 1000);
const center = mouseSteeringFromClientX(500, 0, 1000);
const right = mouseSteeringFromClientX(1000, 0, 1000);
const nearCenter = mouseSteeringFromClientX(515, 0, 1000);
const quarterLeft = mouseSteeringFromClientX(250, 0, 1000);
const quarterRight = mouseSteeringFromClientX(750, 0, 1000);
const pastLeft = mouseSteeringFromClientX(-500, 0, 1000);
const pastRight = mouseSteeringFromClientX(1500, 0, 1000);

assert.equal(left, 1, 'left edge must map to +1 (canonical LEFT steer)');
assert.equal(center, 0, 'canvas center must map to neutral steer');
assert.equal(right, -1, 'right edge must map to -1 (canonical RIGHT steer)');
assert.equal(nearCenter, 0, 'small center movement should stay inside the steering deadzone');
assert(quarterLeft > 0 && quarterLeft < 1, 'left-side cursor position should produce proportional positive steering');
assert(quarterRight < 0 && quarterRight > -1, 'right-side cursor position should produce proportional negative steering');
assert(Math.abs(quarterLeft + quarterRight) < 1e-12, 'mouse steering must mirror exactly left/right');
assert.equal(pastLeft, 1, 'mouse steering must clamp beyond the left edge');
assert.equal(pastRight, -1, 'mouse steering must clamp beyond the right edge');

console.log(JSON.stringify({ left, center, right, nearCenter, quarterLeft, quarterRight }, null, 2));
console.log('MouseSteeringInputTests: PASS');

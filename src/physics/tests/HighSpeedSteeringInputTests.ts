import assert from 'node:assert/strict';
import {
  digitalSteerWindRatePerSecond,
  slewAnalogSteeringInput,
  updateDigitalSteeringInput,
} from '../DigitalSteeringInput';

const DT = 1 / 120;

function holdDigital(
  direction: -1 | 0 | 1,
  speedKmh: number,
  seconds: number,
  start = 0
) {
  let value = start;
  for (let i = 0; i < Math.round(seconds / DT); i++) {
    value = updateDigitalSteeringInput(value, direction, speedKmh / 3.6, DT);
  }
  return value;
}

function holdAnalog(
  target: number,
  speedKmh: number,
  seconds: number,
  start = 0
) {
  let value = start;
  for (let i = 0; i < Math.round(seconds / DT); i++) {
    value = slewAnalogSteeringInput(value, target, speedKmh / 3.6, DT);
  }
  return value;
}

const lowRate = digitalSteerWindRatePerSecond(0);
const rate100 = digitalSteerWindRatePerSecond(100 / 3.6);
const rate150 = digitalSteerWindRatePerSecond(150 / 3.6);
const rate180 = digitalSteerWindRatePerSecond(180 / 3.6);

assert(lowRate > rate100 && rate100 > rate150 && rate150 >= rate180,
  'ordinary steering wind-on must calm progressively with road speed');
assert(rate180 >= 1.39, 'high-speed wind-on rate fell below the recovery-safe floor');

// The former constant 4.8/s path reached ~0.72 rack fraction in 150 ms.
// A normal 150 km/h turn-in must build much more progressively.
const digital150 = holdDigital(1, 150, 0.15);
const digital150Mirror = holdDigital(-1, 150, 0.15);
assert(digital150 > 0.15 && digital150 < 0.40,
  `150 km/h digital turn-in is still too abrupt: ${digital150.toFixed(3)}`);
assert(Math.abs(digital150 + digital150Mirror) < 1e-12,
  'digital high-speed steering must mirror left/right exactly');

// Analog mouse/on-screen-wheel targets used to teleport to the raw target in one
// render frame. The applied command must now obey the same high-speed hand rate.
const analogOneStep = slewAnalogSteeringInput(0, 1, 150 / 3.6, DT);
assert(analogOneStep > 0 && analogOneStep <= rate150 * DT + 1e-12,
  `analog target teleported into the rack: ${analogOneStep.toFixed(4)}`);
assert(Math.abs(
  analogOneStep + slewAnalogSteeringInput(0, -1, 150 / 3.6, DT)
) < 1e-12, 'analog high-speed steering must mirror left/right exactly');

// We are changing input velocity, not mechanical rack travel.
assert(Math.abs(holdDigital(1, 150, 1.0) - 1) < 1e-12,
  'digital full rack authority must remain available');
assert(Math.abs(holdAnalog(1, 150, 1.0) - 1) < 1e-12,
  'analog full rack authority must remain available');

// Opposite-lock and unwind are deliberately faster than ordinary wind-on.
let digitalRecovery = 0.25;
digitalRecovery = holdDigital(-1, 150, 0.10, digitalRecovery);
assert(digitalRecovery < -0.25,
  `digital countersteer recovery became too slow: ${digitalRecovery.toFixed(3)}`);

let analogRecovery = 0.25;
analogRecovery = holdAnalog(-1, 150, 0.10, analogRecovery);
assert(analogRecovery < -0.25,
  `analog countersteer recovery became too slow: ${analogRecovery.toFixed(3)}`);

const released = holdAnalog(0, 150, 0.20, 0.9);
assert(Math.abs(released) < 1e-12, 'analog steering must unwind to center promptly');

console.log('HighSpeedSteeringInputTests: PASS');

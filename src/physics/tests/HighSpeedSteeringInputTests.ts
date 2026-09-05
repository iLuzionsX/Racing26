import assert from 'node:assert/strict';
import {
  digitalCountersteerRecoveryBlend,
  digitalSteeringLimitForSpeed,
  digitalSteeringTarget,
  slewAnalogSteeringInput,
  updateDigitalSteeringInput,
  type DigitalSteeringContext,
} from '../DigitalSteeringInput';

const DT = 1 / 120;
const WHEELBASE_M = 3.00482;
const MAX_STEER_RAD = 0.58;

function impliedLateralG(speedKmh: number, normalizedSteer: number) {
  const speedMs = speedKmh / 3.6;
  const roadWheelAngle = Math.abs(normalizedSteer) * MAX_STEER_RAD;
  return (speedMs * speedMs * Math.tan(roadWheelAngle) / WHEELBASE_M) / 9.81;
}

const baseContext = (speedKmh: number): DigitalSteeringContext => ({
  wheelbaseM: WHEELBASE_M,
  maxSteerAngleRad: MAX_STEER_RAD,
  forwardSpeedMs: speedKmh / 3.6,
});

for (const speedKmh of [100, 130, 160, 180]) {
  const speedMs = speedKmh / 3.6;
  const context = baseContext(speedKmh);
  const limit = digitalSteeringLimitForSpeed(speedMs, context);
  assert(limit > 0 && limit < 0.25, `${speedKmh} km/h digital limit is implausible: ${limit}`);
  assert(
    impliedLateralG(speedKmh, limit) <= 0.90,
    `${speedKmh} km/h normal digital command exceeds useful tire envelope`
  );

  let left = 0;
  let right = 0;
  for (let i = 0; i < Math.round(1.0 / DT); i++) {
    left = updateDigitalSteeringInput(left, 1, speedMs, DT, context);
    right = updateDigitalSteeringInput(right, -1, speedMs, DT, context);
  }
  assert(Math.abs(left - limit) < 1e-9, `${speedKmh} km/h left did not settle at envelope`);
  assert(Math.abs(right + limit) < 1e-9, `${speedKmh} km/h right did not mirror envelope`);
}

// Mild opposite steering in a chicane must stay inside the normal envelope.
const chicane: DigitalSteeringContext = {
  ...baseContext(150),
  yawRateRadS: 0.35,
  sideslipRad: -2 * Math.PI / 180,
};
assert(digitalCountersteerRecoveryBlend(-1, 150 / 3.6, chicane) === 0);
assert(
  Math.abs(digitalSteeringTarget(-1, 150 / 3.6, chicane)) <=
    digitalSteeringLimitForSpeed(150 / 3.6, chicane) + 1e-12
);

// Genuine oversteer must unlock substantial/full opposite-lock authority.
const severeRecovery: DigitalSteeringContext = {
  ...baseContext(150),
  yawRateRadS: 1.05,
  sideslipRad: -18 * Math.PI / 180,
};
const recoveryBlend = digitalCountersteerRecoveryBlend(-1, 150 / 3.6, severeRecovery);
const recoveryTarget = digitalSteeringTarget(-1, 150 / 3.6, severeRecovery);
assert(recoveryBlend > 0.95, `severe slide did not unlock recovery: ${recoveryBlend}`);
assert(recoveryTarget < -0.95, `severe slide lost opposite lock: ${recoveryTarget}`);

let recovery = 0.15;
for (let i = 0; i < Math.round(0.15 / DT); i++) {
  recovery = updateDigitalSteeringInput(recovery, -1, 150 / 3.6, DT, severeRecovery);
}
assert(recovery < -0.75, `state-aware recovery is too slow: ${recovery.toFixed(3)}`);

// Analog hand position is not amplitude-capped: only teleport velocity is removed.
const oneStep = slewAnalogSteeringInput(0, 1, DT);
assert(oneStep > 0 && oneStep <= 4.8 * DT + 1e-12, `analog teleported: ${oneStep}`);
assert(Math.abs(oneStep + slewAnalogSteeringInput(0, -1, DT)) < 1e-12);

let analog = 0;
for (let i = 0; i < Math.round(0.25 / DT); i++) {
  analog = slewAnalogSteeringInput(analog, 1, DT);
}
assert(Math.abs(analog - 1) < 1e-12, 'analog full mechanical rack must remain available');

let analogRecovery = 0.25;
for (let i = 0; i < Math.round(0.10 / DT); i++) {
  analogRecovery = slewAnalogSteeringInput(analogRecovery, -1, DT);
}
assert(analogRecovery < -0.25, `analog countersteer is too slow: ${analogRecovery.toFixed(3)}`);

console.log('HighSpeedSteeringInputTests: PASS');

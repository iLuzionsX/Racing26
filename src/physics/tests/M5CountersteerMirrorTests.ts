import assert from 'node:assert/strict';
import { Simulation } from '../Simulation';
import { DEFAULT_VEHICLE_CONFIG } from '../vehiclePresets';
import { BMW_M5_2025_OVERRIDES } from '../m5G90';
import { PhysicsMath } from '../math/PhysicsMath';
import { updateDigitalSteeringInput, digitalCountersteerRecoveryBlend } from '../DigitalSteeringInput';
const DT = 1 / 120;
const DEG = 180 / Math.PI;
const neutral = { throttle: 0, brake: 0, steer: 0, handbrake: false, shiftUp: false, shiftDown: false };
function makeSim() {
  const config = { ...DEFAULT_VEHICLE_CONFIG, ...BMW_M5_2025_OVERRIDES, absMode: 'OFF', tcsMode: 'OFF' } as any;
  const sim = new Simulation(config);
  sim.reset(0, 0, 0);
  for (let i = 0; i < 300; i++) sim.stepExplicit(neutral, 1);
  const speedMs = 25;
  sim.vehicle.rigidBody.velocity = PhysicsMath.vec3(0, 0, speedMs);
  sim.vehicle.wheels.forEach((w) => w.reset(speedMs));
  for (let i = 0; i < 60; i++) sim.stepExplicit(neutral, 1);
  return sim;
}
function recoveryContext(sim: Simulation) {
  const v = sim.vehicle.rigidBody.getLocalVelocity();
  const w = sim.vehicle.rigidBody.getLocalAngularVelocity();
  const s = Math.hypot(v.x, v.z);
  return { speedMs: s, context: { wheelbaseM: sim.vehicle.config.wheelbase, maxSteerAngleRad: sim.vehicle.config.maxSteerAngle, yawRateRadS: w.y, sideslipRad: s > 0.5 ? Math.atan2(v.x, Math.max(0.5, Math.abs(v.z))) : 0, forwardSpeedMs: v.z } };
}
function runOversteer(initialSign: 1 | -1) {
  const sim = makeSim();
  const steerInit = 0.18 * initialSign;
  const counterDir = (initialSign > 0 ? -1 : 1) as -1 | 1;
  for (let i = 0; i < 90; i++) sim.stepExplicit({ ...neutral, steer: steerInit }, 1);
  for (let i = 0; i < Math.round(0.30 / DT); i++) sim.stepExplicit({ ...neutral, steer: steerInit, handbrake: true }, 1);
  let digital = steerInit;
  let peak = 0;
  let release: number | null = null;
  for (let i = 1; i <= Math.round(1.5 / DT); i++) {
    const before = sim.vehicle.getState();
    if (release === null && Math.abs(before.yawRate * DEG) <= 8) release = i * DT;
    const dir: -1 | 0 = release === null ? counterDir : 0;
    const rc = recoveryContext(sim);
    digital = updateDigitalSteeringInput(digital, dir, rc.speedMs, DT, rc.context);
    if (release === null) peak = Math.max(peak, Math.abs(digital));
    sim.stepExplicit({ ...neutral, steer: digital }, 1);
  }
  const end = sim.vehicle.getState();
  const v = sim.vehicle.rigidBody.getLocalVelocity();
  const beta = Math.atan2(v.x, Math.max(0.1, Math.abs(v.z))) * DEG;
  return { peak, release, yaw: Math.abs(end.yawRate * DEG), beta: Math.abs(beta) };
}
const left = runOversteer(1);
const right = runOversteer(-1);
assert(left.peak > 0.8, 'left oversteer must unlock opposite lock');
assert(right.peak > 0.8, 'mirrored right oversteer must unlock opposite lock');
assert(Math.abs(left.peak - right.peak) < 0.08, 'mirror peak authority must match');
assert(left.release !== null && left.release < 0.40, 'left must arrest promptly');
assert(right.release !== null && right.release < 0.40, 'mirrored right must arrest promptly');
assert(left.yaw < 2 && right.yaw < 2, 'both directions must settle yaw');
assert(left.beta < 2 && right.beta < 2, 'both directions must settle sideslip');
function stableHold(dir: 1 | -1) {
  const sim = makeSim();
  let digital = 0;
  let peak = 0;
  for (let i = 0; i < Math.round(2.0 / DT); i++) {
    const rc = recoveryContext(sim);
    assert.equal(digitalCountersteerRecoveryBlend(dir, rc.speedMs, rc.context), 0, 'stable hold must not trigger recovery');
    digital = updateDigitalSteeringInput(digital, dir, rc.speedMs, DT, rc.context);
    peak = Math.max(peak, Math.abs(digital));
    sim.stepExplicit({ ...neutral, steer: digital }, 1);
  }
  return peak;
}
const holdL = stableHold(1);
const holdR = stableHold(-1);
assert(holdL < 0.30 && holdR < 0.30, 'stable holds must stay inside envelope');
assert(Math.abs(holdL - holdR) < 0.05, 'stable holds must mirror');
console.log('M5CountersteerMirrorTests: PASS');

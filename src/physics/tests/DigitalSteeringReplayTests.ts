import assert from 'node:assert/strict';
import type { VehicleConfig } from '../../types';
import { Simulation } from '../Simulation';
import { ProvingGroundSurfaceProvider } from '../SurfaceProvider';
import { DEFAULT_VEHICLE_CONFIG } from '../vehiclePresets';
import { BMW_M5_2025_OVERRIDES } from '../m5G90';
import {
  digitalCountersteerRecoveryBlend,
  digitalSteeringLimitForSpeed,
  digitalSteeringTarget,
  updateDigitalSteeringInput,
  type DigitalSteeringContext,
} from '../DigitalSteeringInput';

// Deterministic replay regression for Digital Driver V2.
// Canonical: +steer/+yaw = left, +X left/+Z forward. No behavior tuning.
const DT = 1 / 120;
const WHEELBASE_M = 3.00482;
const MAX_STEER_RAD = 0.58;
const M5_CONFIG = { ...DEFAULT_VEHICLE_CONFIG, ...BMW_M5_2025_OVERRIDES } as VehicleConfig;
const NEUTRAL = { throttle: 0, brake: 0, steer: 0, handbrake: false, shiftUp: false, shiftDown: false };

type TraceStep = { direction: -1 | 0 | 1; speedMs: number; context: DigitalSteeringContext };

function baseContext(overrides: Partial<DigitalSteeringContext> = {}): DigitalSteeringContext {
  return { wheelbaseM: WHEELBASE_M, maxSteerAngleRad: MAX_STEER_RAD, forwardSpeedMs: 25, ...overrides };
}

function buildNormalTrace(): TraceStep[] {
  const steps: TraceStep[] = [];
  for (let i = 0; i < 360; i++) {
    const t = i * DT;
    const speedMs = 100 / 3.6 + Math.sin(t * 2.1) * 2.0;
    const direction: -1 | 0 | 1 = i < 120 ? 1 : i < 180 ? 0 : i < 300 ? -1 : 0;
    steps.push({
      direction,
      speedMs,
      context: baseContext({
        forwardSpeedMs: speedMs,
        yawRateRadS: 0.05 * Math.sin(t * 1.3),
        sideslipRad: 0.01 * Math.sin(t * 0.9),
      }),
    });
  }
  return steps;
}

function buildRecoveryTrace(): TraceStep[] {
  const steps: TraceStep[] = [];
  for (let i = 0; i < 180; i++) {
    const t = i * DT;
    const speedMs = 100 / 3.6 + Math.sin(t * 3.7) * 0.8;
    steps.push({
      direction: -1,
      speedMs,
      context: baseContext({
        forwardSpeedMs: speedMs,
        yawRateRadS: 0.72 + 0.05 * Math.sin(t * 5.1),
        sideslipRad: (-10 * Math.PI) / 180 + 0.01 * Math.sin(t * 4.3),
      }),
    });
  }
  return steps;
}

function mirrorTrace(trace: TraceStep[]): TraceStep[] {
  return trace.map((s) => ({
    direction: (s.direction === 0 ? 0 : s.direction === 1 ? -1 : 1) as -1 | 0 | 1,
    speedMs: s.speedMs,
    context: { ...s.context, yawRateRadS: -(s.context.yawRateRadS ?? 0), sideslipRad: -(s.context.sideslipRad ?? 0) },
  }));
}

function runTrace(initial: number, trace: TraceStep[]): number[] {
  let cur = initial;
  const out: number[] = [];
  for (const s of trace) {
    cur = updateDigitalSteeringInput(cur, s.direction, s.speedMs, DT, s.context);
    out.push(cur);
  }
  return out;
}

function testPureCommandReplayBitStable(): void {
  const trace = buildNormalTrace();
  const a = runTrace(0.1, trace);
  const b = runTrace(0.1, trace);
  assert.equal(a.length, b.length);
  for (let i = 0; i < a.length; i++) assert(a[i] === b[i], `normal replay diverged at ${i}: ${a[i]} vs ${b[i]}`);
}

function testRecoveryReplayBitStableAndMirrored(): void {
  const trace = buildRecoveryTrace();
  const a = runTrace(0.1, trace);
  const b = runTrace(0.1, trace);
  for (let i = 0; i < a.length; i++) assert(a[i] === b[i], `recovery replay diverged at ${i}`);
  assert(a.some((v) => v < -0.4), 'recovery trace did not exercise meaningful opposite lock');
  const mirrored = mirrorTrace(trace);
  const c = runTrace(0.1, mirrored);
  // Mirrored initial sign must be mirrored too for exact symmetry check.
  const d = runTrace(-0.1, mirrored);
  void c;
  const e = runTrace(0.1, trace);
  for (let i = 0; i < e.length; i++) assert(e[i] === a[i], 'recovery replay not stable on third run');
  const f = runTrace(-0.1, mirrored);
  for (let i = 0; i < a.length; i++) assert(f[i] === -a[i], `recovery mirror failed at ${i}: ${f[i]} vs ${-a[i]}`);
  assert(d.length === f.length);
}

function testStateFreeShaping(): void {
  const speed = 100 / 3.6;
  const limitA = digitalSteeringLimitForSpeed(speed, baseContext({ yawRateRadS: 0, sideslipRad: 0 }));
  const limitB = digitalSteeringLimitForSpeed(speed, baseContext({ yawRateRadS: 0.9, sideslipRad: -0.2, forwardSpeedMs: -5 }));
  assert(limitA === limitB, 'normal limit must ignore yaw/sideslip/travel direction');
  const recA = digitalCountersteerRecoveryBlend(-1, speed, baseContext({ forwardSpeedMs: speed, yawRateRadS: 0.72, sideslipRad: -0.17 }));
  const recB = digitalCountersteerRecoveryBlend(-1, speed, baseContext({ forwardSpeedMs: speed, yawRateRadS: 0.72, sideslipRad: -0.17, wheelbaseM: 2.2, maxSteerAngleRad: 0.9, targetLateralAccelerationG: 0.5 }));
  assert(recA === recB, 'recovery blend must ignore wheelbase/rack/target-G render tuning');
  const chicane: DigitalSteeringContext = baseContext({ forwardSpeedMs: speed, yawRateRadS: 0.35, sideslipRad: (-2 * Math.PI) / 180 });
  assert(digitalCountersteerRecoveryBlend(-1, speed, chicane) === 0, 'mild chicane must not latch recovery');
  assert(digitalSteeringTarget(-1, speed, chicane) === -limitA, 'non-recovery target must equal mirrored soft limit');
}

function testNoOrderContamination(): void {
  const step: TraceStep = { direction: 1, speedMs: 70 / 3.6, context: baseContext({ forwardSpeedMs: 70 / 3.6 }) };
  const direct = updateDigitalSteeringInput(0.2, step.direction, step.speedMs, DT, step.context);
  for (let i = 0; i < 50; i++) {
    updateDigitalSteeringInput(-0.7 + i * 0.01, (i % 2 === 0 ? -1 : 1) as -1 | 1, 30 / 3.6 + i * 0.1, DT, baseContext({ forwardSpeedMs: 5, yawRateRadS: 1.0, sideslipRad: 0.3 }));
  }
  const after = updateDigitalSteeringInput(0.2, step.direction, step.speedMs, DT, step.context);
  assert(direct === after, 'unrelated interleaved calls changed a pure result');
}

function makeRollingM5(speedMs: number): Simulation {
  const sim = new Simulation(M5_CONFIG, new ProvingGroundSurfaceProvider());
  sim.reset(0, 0, 0);
  sim.vehicle.powertrain.isAutomatic = false;
  (sim.vehicle.powertrain as unknown as { gear: number }).gear = 0;
  for (let i = 0; i < 240; i++) sim.stepExplicit({ ...NEUTRAL }, 1);
  sim.vehicle.rigidBody.velocity.x = 0;
  sim.vehicle.rigidBody.velocity.z = speedMs;
  for (const w of sim.vehicle.wheels) w.reset(speedMs);
  for (let i = 0; i < 60; i++) sim.stepExplicit({ ...NEUTRAL }, 1);
  return sim;
}

function runFullVehicleScenario(direction: 1 | -1, speedKmh: number, holdSec: number): { commands: number[]; x: number; z: number; yaw: number } {
  const sim = makeRollingM5(speedKmh / 3.6);
  let digital = 0;
  const commands: number[] = [];
  const steps = Math.round(holdSec / DT);
  for (let i = 0; i < steps; i++) {
    const lv = sim.vehicle.rigidBody.getLocalVelocity();
    const lw = sim.vehicle.rigidBody.getLocalAngularVelocity();
    const speedMs = Math.hypot(lv.x, lv.z);
    const sideslip = speedMs > 0.5 ? Math.atan2(lv.x, Math.max(0.5, Math.abs(lv.z))) : 0;
    const ctx: DigitalSteeringContext = { wheelbaseM: M5_CONFIG.wheelbase, maxSteerAngleRad: M5_CONFIG.maxSteerAngle, yawRateRadS: lw.y, sideslipRad: sideslip, forwardSpeedMs: lv.z };
    digital = updateDigitalSteeringInput(digital, direction, speedMs, DT, ctx);
    commands.push(digital);
    sim.stepExplicit({ ...NEUTRAL, steer: digital }, 1);
  }
  const s = sim.vehicle.getState();
  return { commands, x: s.x, z: s.z, yaw: s.yaw };
}

function testFullVehicleReplayToleranceStable(): void {
  const a = runFullVehicleScenario(1, 100, 2.0);
  const b = runFullVehicleScenario(1, 100, 2.0);
  assert.equal(a.commands.length, b.commands.length);
  for (let i = 0; i < a.commands.length; i++) assert(a.commands[i] === b.commands[i], `vehicle command replay diverged at ${i}`);
  assert(a.x === b.x && a.z === b.z && a.yaw === b.yaw, `vehicle trajectory not bit-stable: ${a.x},${a.z},${a.yaw} vs ${b.x},${b.z},${b.yaw}`);
}

testPureCommandReplayBitStable();
console.log('PASS normal speed/yaw/sideslip/input trace replays bit-stable');
testRecoveryReplayBitStableAndMirrored();
console.log('PASS recovery transition replays bit-stable and mirrors exactly');
testStateFreeShaping();
console.log('PASS normal shaping and recovery depend only on their documented context');
testNoOrderContamination();
console.log('PASS no unrelated render/order-state contamination');
testFullVehicleReplayToleranceStable();
console.log('PASS full-vehicle digital-driver scenario replays stable');
console.log('DigitalSteeringReplayTests: PASS');

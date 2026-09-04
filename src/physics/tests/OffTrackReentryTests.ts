import assert from 'node:assert/strict';
import type { ControlInputs } from '../../types';
import { Simulation } from '../Simulation';
import { ProvingGroundSurfaceProvider } from '../SurfaceProvider';
import { DEFAULT_VEHICLE_CONFIG } from '../vehiclePresets';
import { BMW_M5_2025_OVERRIDES } from '../m5G90';
import { PhysicsMath } from '../math/PhysicsMath';

const DT = 1 / 120;

const config = {
  ...DEFAULT_VEHICLE_CONFIG,
  ...BMW_M5_2025_OVERRIDES,
} as any;

const neutral: ControlInputs = {
  throttle: 0,
  brake: 0,
  steer: 0,
  handbrake: false,
  shiftUp: false,
  shiftDown: false,
};

function makeRollingSim(startX: number, startZ: number, yaw: number, speedMs: number): Simulation {
  const sim = new Simulation(config, new ProvingGroundSurfaceProvider());
  sim.reset(startX, startZ, yaw);
  sim.vehicle.powertrain.isAutomatic = false;
  (sim.vehicle.powertrain as any).gear = 0;
  for (let i = 0; i < 180; i++) sim.stepExplicit(neutral, 1);
  sim.vehicle.rigidBody.velocity = PhysicsMath.vec3(Math.sin(yaw) * speedMs, 0, Math.cos(yaw) * speedMs);
  for (const wheel of sim.vehicle.wheels) wheel.reset(speedMs);
  for (let i = 0; i < 30; i++) sim.stepExplicit(neutral, 1);
  return sim;
}

interface ReentryMetrics {
  speedKmh: number;
  startX: number;
  steer: number;
  maxAbsYawRate: number;
  maxAbsYawAccel: number;
  maxAbsLatG: number;
  maxStepYaw: number;
  initialMeanFriction: number;
  finalX: number;
  finalYaw: number;
}

function runReentry(startX: number, steer: number, speedKmh: number, steps = 480): ReentryMetrics {
  const speedMs = speedKmh / 3.6;
  const sim = makeRollingSim(startX, 0, 0, speedMs);
  let prevYawRate = sim.vehicle.getState().yawRate;
  let prevYaw = sim.vehicle.getState().yaw;
  let maxAbsYawRate = Math.abs(prevYawRate);
  let maxAbsYawAccel = 0;
  let maxAbsLatG = 0;
  let maxStepYaw = 0;
  let initialFrictionSum = 0;
  let finalX = startX;
  let finalYaw = 0;
  for (let step = 0; step < steps; step++) {
    const state = sim.stepExplicit({ ...neutral, steer }, 1);
    assert(Number.isFinite(state.yawRate), 'non-finite yawRate');
    assert(Number.isFinite(state.lateralG), 'non-finite latG');
    for (const wheel of state.wheels) {
      assert(Number.isFinite(wheel.forceVectorLat), 'non-finite Fy');
      assert(Number.isFinite(wheel.forceVectorLong), 'non-finite Fx');
      assert(Number.isFinite(wheel.forceVectorNorm), 'non-finite Fz');
    }
    const yawAccel = Math.abs(state.yawRate - prevYawRate) / DT;
    maxAbsYawAccel = Math.max(maxAbsYawAccel, yawAccel);
    maxAbsYawRate = Math.max(maxAbsYawRate, Math.abs(state.yawRate));
    maxAbsLatG = Math.max(maxAbsLatG, Math.abs(state.lateralG));
    maxStepYaw = Math.max(maxStepYaw, Math.abs(state.yaw - prevYaw));
    prevYawRate = state.yawRate;
    prevYaw = state.yaw;
    if (step < 30) initialFrictionSum += (state.wheels[0].surfaceFriction + state.wheels[1].surfaceFriction + state.wheels[2].surfaceFriction + state.wheels[3].surfaceFriction) / 4;
    if (step === steps - 1) { finalX = state.x; finalYaw = state.yaw; }
  }
  return { speedKmh, startX, steer, maxAbsYawRate, maxAbsYawAccel, maxAbsLatG, maxStepYaw, initialMeanFriction: initialFrictionSum / 30, finalX, finalYaw };
}

function checkMirroredPair(left: ReentryMetrics, right: ReentryMetrics, label: string): void {
  assert(Math.abs(left.maxAbsYawRate - right.maxAbsYawRate) <= Math.max(0.10, 0.25 * Math.max(left.maxAbsYawRate, right.maxAbsYawRate)), 'yaw-rate mirror failed');
  assert(Math.abs(left.maxAbsYawAccel - right.maxAbsYawAccel) <= Math.max(1.5, 0.30 * Math.max(left.maxAbsYawAccel, right.maxAbsYawAccel)), 'yaw-accel mirror failed');
  assert(Math.abs(left.maxAbsLatG - right.maxAbsLatG) <= Math.max(0.08, 0.25 * Math.max(left.maxAbsLatG, right.maxAbsLatG)), 'latG mirror failed');
  assert(Math.abs(left.finalX + right.finalX) <= Math.max(1.0, 0.15 * Math.max(Math.abs(left.finalX), Math.abs(right.finalX))), 'trajectory mirror failed');
  assert(Math.abs(left.finalYaw + right.finalYaw) <= Math.max(0.02, 0.25 * Math.max(Math.abs(left.finalYaw), Math.abs(right.finalYaw))), 'yaw mirror failed');
}

const SPEEDS_KMH = [40, 70, 100];
const results: Array<{ label: string; left: ReentryMetrics; right: ReentryMetrics }> = [];

for (const speedKmh of SPEEDS_KMH) {
  const fullLeft = runReentry(27, -0.20, speedKmh);
  const fullRight = runReentry(-27, 0.20, speedKmh);
  assert(fullLeft.initialMeanFriction < 0.70, 'full-gravel start not low-mu');
  assert(fullRight.initialMeanFriction < 0.70, 'mirrored full-gravel start not low-mu');
  assert(fullLeft.maxAbsYawAccel < 20, 'full re-entry yaw snap');
  assert(fullRight.maxAbsYawAccel < 20, 'mirrored full re-entry yaw snap');
  assert(fullLeft.maxAbsYawRate < 1.5 && fullRight.maxAbsYawRate < 1.5, 're-entry spin');
  assert(fullLeft.maxStepYaw < 0.02 && fullRight.maxStepYaw < 0.02, 'yaw teleport');
  checkMirroredPair(fullLeft, fullRight, 'full-car');
  results.push({ label: 'full', left: fullLeft, right: fullRight });

  const splitLeft = runReentry(19.5, -0.18, speedKmh);
  const splitRight = runReentry(-19.5, 0.18, speedKmh);
  assert(splitLeft.maxAbsYawAccel < 20, 'split re-entry yaw snap');
  assert(splitRight.maxAbsYawAccel < 20, 'mirrored split re-entry yaw snap');
  assert(splitLeft.maxStepYaw < 0.02 && splitRight.maxStepYaw < 0.02, 'split yaw teleport');
  checkMirroredPair(splitLeft, splitRight, 'split');
  results.push({ label: 'split', left: splitLeft, right: splitRight });
}

console.log(JSON.stringify({ scenario: 'M5 off-track recovery/re-entry 40-100 km/h', speedsKmh: SPEEDS_KMH, results }, null, 2));
console.log('OffTrackReentryTests: PASS');

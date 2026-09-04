import assert from 'node:assert/strict';
import type { ControlInputs, VehicleConfig } from '../../types';
import { Simulation } from '../Simulation';
import { ProvingGroundSurfaceProvider } from '../SurfaceProvider';
import { DEFAULT_VEHICLE_CONFIG } from '../vehiclePresets';
import { BMW_M5_2025_OVERRIDES } from '../m5G90';
import { PhysicsMath } from '../math/PhysicsMath';

// Deterministic high-speed constant step-steer regression.
// Canonical conventions: wheel order [FL,FR,RL,RR], +X left/+Y up/+Z forward,
// positive steer/yaw = left. Left (+1) and right (-1) cases must mirror.
// No validation-only forces/pose/yaw/grip overrides: free-rolling chassis
// (gear 0, zero throttle/brake) after a clean velocity init, normal tire/diff/suspension path.
const DT = 1 / 120;
const DEG = 180 / Math.PI;
const SPEEDS_KMH = [100, 120, 150, 180];
// Well-below-limit steady demands so a correct M5 must NOT spin.
const TARGET_LAT_G: Record<number, number> = { 100: 0.45, 120: 0.45, 150: 0.35, 180: 0.35 };

const neutral: ControlInputs = { throttle: 0, brake: 0, steer: 0, handbrake: false, shiftUp: false, shiftDown: false };
const config = { ...DEFAULT_VEHICLE_CONFIG, ...BMW_M5_2025_OVERRIDES } as VehicleConfig;

function steerInputForLatG(speedMs: number, targetG: number): number {
  // Kinematic bicycle demand plus small understeer margin; physical road-wheel
  // demand, NOT a hidden assist. Full rack remains available; this helper only
  // sizes the deterministic test request to a plausible high-speed corner.
  const deltaRad = (targetG * 9.81 * config.wheelbase) / Math.max(1, speedMs * speedMs);
  return (deltaRad * 1.15) / config.maxSteerAngle;
}

function makeRollingM5(speedMs: number): Simulation {
  const sim = new Simulation(config, new ProvingGroundSurfaceProvider());
  sim.reset(0, 0, 0);
  sim.vehicle.powertrain.isAutomatic = false;
  sim.vehicle.powertrain.gear = 0;
  for (let i = 0; i < 240; i++) sim.stepExplicit(neutral, 1);
  sim.vehicle.rigidBody.velocity = PhysicsMath.vec3(0, 0, speedMs);
  for (const wheel of sim.vehicle.wheels) wheel.reset(speedMs);
  for (let i = 0; i < 60; i++) sim.stepExplicit(neutral, 1);
  return sim;
}

type CaseResult = { speedKmh: number; direction: 1 | -1; steerInput: number; steadyYawDegS: number; peakYawDegS: number; overshoot: number; steadySideslipDeg: number; peakSideslipDeg: number; steadyLatG: number; peakLatG: number; minInsideFzN: number; maxFrontSlipDeg: number; maxRearSlipDeg: number; spun: boolean };

function runCase(speedKmh: number, direction: 1 | -1): CaseResult {
  const speedMs = speedKmh / 3.6;
  const steerInput = steerInputForLatG(speedMs, TARGET_LAT_G[speedKmh]) * direction;
  const sim = makeRollingM5(speedMs);
  let peakYaw = 0;
  let peakSlip = 0;
  let peakG = 0;
  let maxFrontSlip = 0;
  let maxRearSlip = 0;
  let minInsideFz = Number.POSITIVE_INFINITY;
  let spun = false;
  const steadyYawSamples: number[] = [];
  const steadySlipSamples: number[] = [];
  const steadyGSamples: number[] = [];
  const totalSteps = Math.round(3.0 / DT);
  for (let step = 0; step < totalSteps; step++) {
    const state = sim.stepExplicit({ ...neutral, steer: steerInput }, 1);
    const yawDegS = state.yawRate * DEG;
    const localV = sim.vehicle.rigidBody.getLocalVelocity();
    const sideslipDeg = Math.atan2(localV.x, Math.max(0.5, Math.abs(localV.z))) * DEG;
    const latG = Math.abs(state.lateralG);
    peakYaw = Math.max(peakYaw, Math.abs(yawDegS));
    peakSlip = Math.max(peakSlip, Math.abs(sideslipDeg));
    peakG = Math.max(peakG, latG);
    maxFrontSlip = Math.max(maxFrontSlip, Math.abs(state.wheels[0].slipAngle) * DEG, Math.abs(state.wheels[1].slipAngle) * DEG);
    maxRearSlip = Math.max(maxRearSlip, Math.abs(state.wheels[2].slipAngle) * DEG, Math.abs(state.wheels[3].slipAngle) * DEG);
    // Inside side unloads in a correct turn; gross inside lift indicates jacking/load bug.
    const insideFz = direction > 0 ? state.wheels[0].forceVectorNorm + state.wheels[2].forceVectorNorm : state.wheels[1].forceVectorNorm + state.wheels[3].forceVectorNorm;
    minInsideFz = Math.min(minInsideFz, insideFz);
    if (Math.abs(sideslipDeg) > 12 || Math.abs(yawDegS) > 60) spun = true;
    assert(state.wheels.length === 4, 'wheel order [FL,FR,RL,RR] violated');
    for (const w of state.wheels) assert(Number.isFinite(w.forceVectorLong + w.forceVectorLat + w.forceVectorNorm + w.slipAngle + w.slipRatio + w.steerAngle), 'non-finite wheel telemetry');
    if (step >= totalSteps - Math.round(0.5 / DT)) {
      steadyYawSamples.push(Math.abs(yawDegS));
      steadySlipSamples.push(Math.abs(sideslipDeg));
      steadyGSamples.push(latG);
    }
  }
  const mean = (v: number[]) => v.reduce((s, x) => s + x, 0) / Math.max(1, v.length);
  const steadyYaw = mean(steadyYawSamples);
  const steadySlip = mean(steadySlipSamples);
  const steadyG = mean(steadyGSamples);
  return { speedKmh, direction, steerInput, steadyYawDegS: steadyYaw, peakYawDegS: peakYaw, overshoot: steadyYaw > 1e-6 ? (peakYaw - steadyYaw) / steadyYaw : 0, steadySideslipDeg: steadySlip, peakSideslipDeg: peakSlip, steadyLatG: steadyG, peakLatG: peakG, minInsideFzN: minInsideFz, maxFrontSlipDeg: maxFrontSlip, maxRearSlipDeg: maxRearSlip, spun };
}

function mirrorError(a: number, b: number): number {
  return Math.abs(Math.abs(a) - Math.abs(b)) / Math.max(0.25, (Math.abs(a) + Math.abs(b)) * 0.5);
}

const results: CaseResult[] = [];
for (const speed of SPEEDS_KMH) {
  const left = runCase(speed, 1);
  const right = runCase(speed, -1);
  results.push(left, right);
  assert(!left.spun, `${speed} km/h left step spun on ${(TARGET_LAT_G[speed])}g demand: peakSlip=${left.peakSideslipDeg.toFixed(1)}deg peakYaw=${left.peakYawDegS.toFixed(1)}deg/s`);
  assert(!right.spun, `${speed} km/h right step spun on ${(TARGET_LAT_G[speed])}g demand`);
  assert(left.peakSideslipDeg < 10 && right.peakSideslipDeg < 10, `${speed} km/h excessive transient sideslip L=${left.peakSideslipDeg.toFixed(1)} R=${right.peakSideslipDeg.toFixed(1)} deg`);
  assert(left.steadySideslipDeg < 6 && right.steadySideslipDeg < 6, `${speed} km/h excessive steady sideslip L=${left.steadySideslipDeg.toFixed(1)} R=${right.steadySideslipDeg.toFixed(1)} deg`);
  assert(left.overshoot < 0.35 && right.overshoot < 0.35, `${speed} km/h yaw overshoot excessive L=${(left.overshoot * 100).toFixed(0)}% R=${(right.overshoot * 100).toFixed(0)}%`);
  assert(mirrorError(left.steadyYawDegS, right.steadyYawDegS) < 0.10, `${speed} km/h yaw mirror drifted`);
  assert(mirrorError(left.steadySideslipDeg, right.steadySideslipDeg) < 0.25, `${speed} km/h sideslip mirror drifted`);
  assert(mirrorError(left.steadyLatG, right.steadyLatG) < 0.10, `${speed} km/h latG mirror drifted`);
  assert(left.minInsideFzN > 1500 && right.minInsideFzN > 1500, `${speed} km/h inside side unloaded implausibly`);
  assert(left.maxFrontSlipDeg < 12 && right.maxFrontSlipDeg < 12, `${speed} km/h front slip saturated on sub-limit demand`);
}

console.log(JSON.stringify({ scenario: 'M5 high-speed step-steer 100/120/150/180 sub-limit demands, mirrored L/R', results }, null, 2));
console.log('HighSpeedStepSteerRegressionTests: PASS');

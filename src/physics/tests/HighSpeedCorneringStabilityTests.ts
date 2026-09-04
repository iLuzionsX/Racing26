import assert from 'node:assert/strict';
import type { ControlInputs, VehicleConfig } from '../../types';
import { Simulation } from '../Simulation';
import { ProvingGroundSurfaceProvider } from '../SurfaceProvider';
import { DEFAULT_VEHICLE_CONFIG } from '../vehiclePresets';
import { BMW_M5_2025_OVERRIDES } from '../m5G90';
import { PhysicsMath } from '../math/PhysicsMath';

const DT = 1 / 120;
const DEG = 180 / Math.PI;
const neutral: ControlInputs = { throttle: 0, brake: 0, steer: 0, handbrake: false, shiftUp: false, shiftDown: false };
const config = { ...DEFAULT_VEHICLE_CONFIG, ...BMW_M5_2025_OVERRIDES, absMode: 'FULL', tcsMode: 'SPORT' } as VehicleConfig;

function makeRolling(speedMs: number) {
  const sim = new Simulation(config, new ProvingGroundSurfaceProvider());
  sim.reset(0, 0, 0);
  sim.vehicle.powertrain.isAutomatic = false;
  sim.vehicle.powertrain.gear = 0;
  sim.vehicle.rigidBody.velocity = PhysicsMath.vec3(0, 0, speedMs);
  for (const w of sim.vehicle.wheels) w.reset(speedMs);
  for (let i = 0; i < 120; i++) sim.stepExplicit(neutral, 1);
  return sim;
}

function sideslipDeg(sim: Simulation) {
  const v = sim.vehicle.rigidBody.getLocalVelocity();
  return Math.atan2(v.x, Math.max(0.1, Math.abs(v.z))) * DEG;
}

function runStep(speedKmh: number, steer: number, dir: 1 | -1) {
  const sim = makeRolling(speedKmh / 3.6);
  const input = steer * dir;
  let peakYaw = 0;
  let peakBeta = 0;
  let peakFrontSlip = 0;
  let peakRearSlip = 0;
  let peakLatG = 0;
  let spinSamples = 0;
  const N = Math.round(3.0 / DT);
  for (let i = 0; i < N; i++) {
    const ramp = Math.min(1, (i + 1) / Math.round(0.25 / DT));
    const s = sim.stepExplicit({ ...neutral, steer: input * ramp }, 1);
    const yaw = Math.abs(s.yawRate) * DEG;
    const beta = Math.abs(sideslipDeg(sim));
    const fSlip = Math.max(Math.abs(s.wheels[0].slipAngle), Math.abs(s.wheels[1].slipAngle)) * DEG;
    const rSlip = Math.max(Math.abs(s.wheels[2].slipAngle), Math.abs(s.wheels[3].slipAngle)) * DEG;
    peakYaw = Math.max(peakYaw, yaw);
    peakBeta = Math.max(peakBeta, beta);
    peakFrontSlip = Math.max(peakFrontSlip, fSlip);
    peakRearSlip = Math.max(peakRearSlip, rSlip);
    peakLatG = Math.max(peakLatG, Math.abs(s.lateralG));
    if (beta > 8 || Math.abs(fSlip) > 12 || Math.abs(rSlip) > 12) spinSamples++;
    for (const [k, v] of Object.entries({ yaw: s.yawRate, beta, fSlip, rSlip })) assert(Number.isFinite(v), `${speedKmh} ${dir} non-finite ${k}`);
  }
  const end = sim.vehicle.getState();
  return { speedKmh, steer: input, peakYaw, peakBeta, peakFrontSlip, peakRearSlip, peakLatG, spinSamples, endYaw: Math.abs(end.yawRate) * DEG, endBeta: Math.abs(sideslipDeg(sim)) };
}

const cases: Array<[number, number]> = [[100, 0.08], [120, 0.08], [140, 0.06], [180, 0.05]];
const results: any[] = [];
for (const [v, st] of cases) {
  const left = runStep(v, st, 1);
  const right = runStep(v, st, -1);
  results.push({ v, st, left, right });
  const mirYaw = Math.abs(Math.abs(left.peakYaw) - Math.abs(right.peakYaw)) / Math.max(1, (Math.abs(left.peakYaw) + Math.abs(right.peakYaw)) / 2);
  const mirLat = Math.abs(left.peakLatG - right.peakLatG) / Math.max(0.2, (left.peakLatG + right.peakLatG) / 2);
  assert(mirYaw < 0.10, `${v} km/h left/right yaw mirror drifted: ${mirYaw}`);
  assert(mirLat < 0.10, `${v} km/h left/right latG mirror drifted: ${mirLat}`);
  assert(left.peakBeta < 8, `${v} km/h left spun: beta ${left.peakBeta.toFixed(1)} yaw ${left.peakYaw.toFixed(1)} fSlip ${left.peakFrontSlip.toFixed(1)} rSlip ${left.peakRearSlip.toFixed(1)}`);
  assert(right.peakBeta < 8, `${v} km/h right spun: beta ${right.peakBeta.toFixed(1)}`);
  assert(left.spinSamples === 0, `${v} km/h left sustained saturation ${left.spinSamples} samples`);
  assert(right.spinSamples === 0, `${v} km/h right sustained saturation ${right.spinSamples} samples`);
}
console.log(JSON.stringify({ scenario: 'M5 high-speed step-steer stability 100-180 km/h', config: { mass: (config as any).mass, maxSteerAngle: (config as any).maxSteerAngle }, results }, null, 2));
console.log('HighSpeedCorneringStabilityTests: PASS');

import assert from 'node:assert/strict';
import type { ControlInputs, VehicleConfig } from '../../types';
import { Simulation } from '../Simulation';
import { ProvingGroundSurfaceProvider } from '../SurfaceProvider';
import { DEFAULT_VEHICLE_CONFIG } from '../vehiclePresets';
import { BMW_M5_2025_OVERRIDES } from '../m5G90';
import { PhysicsMath } from '../math/PhysicsMath';
// Canonical order [FL,FR,RL,RR]; body +X left/+Y up/+Z forward; +steer/+yaw=left.
// Diagnostic only: measures normal simulation, prescribes only initial speed and
// driver steer/throttle. No pose/yaw/force/grip overrides per M5_VALIDATION.md.
const DT = 1 / 120;
const DEG = 180 / Math.PI;
const neutral: ControlInputs = { throttle: 0, brake: 0, steer: 0, handbrake: false, shiftUp: false, shiftDown: false };
const config = { ...DEFAULT_VEHICLE_CONFIG, ...BMW_M5_2025_OVERRIDES, tcsMode: 'OFF', absMode: 'OFF' } as VehicleConfig;
function makeRolling(speedMs: number): Simulation {
  const sim = new Simulation(config, new ProvingGroundSurfaceProvider());
  sim.reset(0, 0, 0);
  for (let i = 0; i < 240; i++) sim.stepExplicit(neutral, 1);
  sim.vehicle.rigidBody.velocity = PhysicsMath.vec3(0, 0, speedMs);
  for (const w of sim.vehicle.wheels) w.reset(speedMs);
  sim.vehicle.powertrain.isAutomatic = false;
  sim.vehicle.powertrain.gear = 0;
  for (let i = 0; i < 60; i++) sim.stepExplicit(neutral, 1);
  return sim;
}
function sideslipDeg(sim: Simulation): number {
  const v = sim.vehicle.rigidBody.getLocalVelocity();
  return Math.atan2(v.x, Math.max(0.5, Math.abs(v.z))) * DEG;
}
// Steady steer hold at speed; returns tail-averaged balance metrics.
function runHold(speedKmh: number, steer: number, direction: 1 | -1) {
  const sim = makeRolling(speedKmh / 3.6);
  const steps = Math.round(3.0 / DT);
  const ramp = Math.round(0.30 / DT);
  let peakBeta = 0; let peakYaw = 0;
  const tail: Array<{ fSlip: number; rSlip: number; fUtil: number; rUtil: number; latG: number; yaw: number }> = [];
  for (let i = 0; i < steps; i++) {
    const r = Math.min(1, (i + 1) / ramp);
    const s = sim.stepExplicit({ ...neutral, steer: steer * direction * r }, 1);
    const fSlip = Math.max(Math.abs(s.wheels[0].slipAngle), Math.abs(s.wheels[1].slipAngle)) * DEG;
    const rSlip = Math.max(Math.abs(s.wheels[2].slipAngle), Math.abs(s.wheels[3].slipAngle)) * DEG;
    const fFy = Math.abs(s.wheels[0].forceVectorLat) + Math.abs(s.wheels[1].forceVectorLat);
    const rFy = Math.abs(s.wheels[2].forceVectorLat) + Math.abs(s.wheels[3].forceVectorLat);
    const fFz = Math.max(1, s.wheels[0].forceVectorNorm + s.wheels[1].forceVectorNorm);
    const rFz = Math.max(1, s.wheels[2].forceVectorNorm + s.wheels[3].forceVectorNorm);
    const beta = Math.abs(sideslipDeg(sim));
    peakBeta = Math.max(peakBeta, beta); peakYaw = Math.max(peakYaw, Math.abs(s.yawRate) * DEG);
    if (i >= steps - Math.round(1.0 / DT)) tail.push({ fSlip, rSlip, fUtil: fFy / fFz, rUtil: rFy / rFz, latG: Math.abs(s.lateralG), yaw: s.yawRate * DEG });
    assert(Number.isFinite(fSlip + rSlip + beta), 'non-finite balance sample');
  }
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
  return { speedKmh, steer: steer * direction, fSlip: mean(tail.map((t) => t.fSlip)), rSlip: mean(tail.map((t) => t.rSlip)), fUtil: mean(tail.map((t) => t.fUtil)), rUtil: mean(tail.map((t) => t.rUtil)), latG: mean(tail.map((t) => t.latG)), yaw: mean(tail.map((t) => t.yaw)), peakBeta, peakYaw };
}
// Small steer that is large at 100-180 km/h: 0.06*0.58 rad ~= 2.0 deg center.
const cases: Array<[number, number]> = [[100, 0.06], [130, 0.05], [150, 0.045], [180, 0.035]];
const lefts = cases.map(([v, s]) => runHold(v, s, 1));
const rights = cases.map(([v, s]) => runHold(v, s, -1));
console.log(JSON.stringify({ scenario: 'M5 high-speed front-vs-rear balance', tcs: 'OFF', abs: 'OFF', lefts, rights }, null, 2));
for (let i = 0; i < cases.length; i++) {
  const L = lefts[i]; const R = rights[i];
  assert(L.peakBeta < 8, `${L.speedKmh} km/h left sideslip ${L.peakBeta.toFixed(1)} deg exceeds skidpad validity; rear-first spin`);
  assert(R.peakBeta < 8, `${R.speedKmh} km/h right sideslip ${R.peakBeta.toFixed(1)} deg exceeds skidpad validity; rear-first spin`);
  assert(L.peakYaw < 45 && R.peakYaw < 45, `yaw runaway at ${L.speedKmh} km/h`);
  // Mirror: yaw/latG/front-slip must agree left vs right within 12%.
  const mir = (a: number, b: number) => Math.abs(Math.abs(a) - Math.abs(b)) / Math.max(0.2, (Math.abs(a) + Math.abs(b)) / 2);
  assert(mir(L.yaw, R.yaw) < 0.12, `yaw mirror drift at ${L.speedKmh} km/h`);
  assert(mir(L.latG, R.latG) < 0.12, `latG mirror drift at ${L.speedKmh} km/h`);
  assert(mir(L.fSlip, R.fSlip) < 0.15, `front-slip mirror drift at ${L.speedKmh} km/h`);
  // Balance: front-heavy M5 must not saturate rear first. Fail if rear slip/util clearly exceeds front.
  for (const [label, r] of [['left', L], ['right', R]] as const) {
    assert(r.rSlip <= Math.max(2.0, r.fSlip * 1.25), `${r.speedKmh} km/h ${label}: rear slip ${r.rSlip.toFixed(1)} deg exceeds front ${r.fSlip.toFixed(1)} deg (rear-first)`);
    assert(r.rUtil <= r.fUtil * 1.20 + 0.05, `${r.speedKmh} km/h ${label}: rear utilization ${r.rUtil.toFixed(2)} exceeds front ${r.fUtil.toFixed(2)} (rear-first)`);
  }
}
console.log('M5HighSpeedUndersteerBalanceTests: PASS');

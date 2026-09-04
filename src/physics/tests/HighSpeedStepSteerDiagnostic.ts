import assert from 'node:assert/strict';
import type { ControlInputs, VehicleConfig } from '../../types';
import { Simulation } from '../Simulation';
import { ProvingGroundSurfaceProvider } from '../SurfaceProvider';
import { DEFAULT_VEHICLE_CONFIG } from '../vehiclePresets';
import { BMW_M5_2025_OVERRIDES } from '../m5G90';
import { PhysicsMath } from '../math/PhysicsMath';
// Deterministic high-speed step-steer characterization, not a stability fix.
// Measures normal simulation behavior only: small physical road-wheel steps at
// 100/140/180 km/h, both mirror directions. No grip/steer/damping overrides.
const DT = 1 / 120;
const DEG = 180 / Math.PI;
const neutral: ControlInputs = { throttle: 0, brake: 0, steer: 0, handbrake: false, shiftUp: false, shiftDown: false };
const config = { ...DEFAULT_VEHICLE_CONFIG, ...BMW_M5_2025_OVERRIDES, absMode: 'OFF', tcsMode: 'OFF' } as VehicleConfig;
function sideslipDeg(sim: Simulation): number {
  const v = sim.vehicle.rigidBody.getLocalVelocity();
  return Math.atan2(v.x, Math.max(0.5, Math.abs(v.z))) * DEG;
}
function makeAtSpeed(speedKmh: number): Simulation {
  const sim = new Simulation(config, new ProvingGroundSurfaceProvider());
  sim.reset(0, 0, 0);
  for (let i = 0; i < 240; i++) sim.stepExplicit(neutral, 1);
  const v = speedKmh / 3.6;
  sim.vehicle.rigidBody.velocity = PhysicsMath.vec3(0, 0, v);
  for (const w of sim.vehicle.wheels) w.reset(v);
  for (let i = 0; i < 120; i++) sim.stepExplicit(neutral, 1);
  return sim;
}
function runStep(speedKmh: number, centerDeg: number, direction: 1 | -1) {
  const sim = makeAtSpeed(speedKmh);
  const steerInput = (centerDeg / DEG / Math.max(1e-6, config.maxSteerAngle)) * direction;
  let peakYaw = 0;
  let steadyYaw = 0;
  let peakSlip = 0;
  let peakRearSlip = 0;
  let peakFrontSlip = 0;
  const yaws: number[] = [];
  const total = Math.round(3.0 / DT);
  for (let i = 0; i < total; i++) {
    const s = sim.stepExplicit({ ...neutral, steer: steerInput }, 1);
    const yaw = s.yawRate * DEG;
    const slip = Math.abs(sideslipDeg(sim));
    const rear = Math.max(Math.abs(s.wheels[2].slipAngle), Math.abs(s.wheels[3].slipAngle)) * DEG;
    const front = Math.max(Math.abs(s.wheels[0].slipAngle), Math.abs(s.wheels[1].slipAngle)) * DEG;
    peakYaw = Math.max(peakYaw, Math.abs(yaw));
    peakSlip = Math.max(peakSlip, slip);
    peakRearSlip = Math.max(peakRearSlip, rear);
    peakFrontSlip = Math.max(peakFrontSlip, front);
    yaws.push(Math.abs(yaw));
    for (const w of s.wheels) assert(Number.isFinite(w.forceVectorLat) && Number.isFinite(w.slipAngle), 'non-finite tire state');
  }
  steadyYaw = yaws.slice(-60).reduce((a, b) => a + b, 0) / 60;
  const overshoot = steadyYaw > 1e-6 ? Math.max(0, peakYaw - steadyYaw) / steadyYaw : 0;
  return { speedKmh, centerDeg, direction, steerInput, peakYawDegS: peakYaw, steadyYawDegS: steadyYaw, overshoot, peakSlipDeg: peakSlip, peakRearSlipDeg: peakRearSlip, peakFrontSlipDeg: peakFrontSlip };
}
const cases: Array<{ speed: number; deg: number }> = [{ speed: 100, deg: 2.0 }, { speed: 140, deg: 1.5 }, { speed: 180, deg: 1.0 }];
const rows: ReturnType<typeof runStep>[] = [];
for (const c of cases) {
  const left = runStep(c.speed, c.deg, 1);
  const right = runStep(c.speed, c.deg, -1);
  rows.push(left, right);
  const yawErr = Math.abs(left.steadyYawDegS - right.steadyYawDegS) / Math.max(0.5, (left.steadyYawDegS + right.steadyYawDegS) / 2);
  const slipErr = Math.abs(left.peakSlipDeg - right.peakSlipDeg) / Math.max(0.25, (left.peakSlipDeg + right.peakSlipDeg) / 2);
  console.log(JSON.stringify({ left, right, mirrorYawErr: yawErr, mirrorSlipErr: slipErr }));
  assert(yawErr < 0.10, `left/right steady yaw not mirrored at ${c.speed} km/h: ${yawErr.toFixed(3)}`);
  assert(slipErr < 0.15, `left/right sideslip not mirrored at ${c.speed} km/h: ${slipErr.toFixed(3)}`);
  assert(left.steadyYawDegS > 0.5 && right.steadyYawDegS > 0.5, `no meaningful turn established at ${c.speed} km/h`);
  assert(left.peakSlipDeg < 8 && right.peakSlipDeg < 8, `small high-speed step produced spin-like sideslip at ${c.speed} km/h`);
  assert(left.overshoot < 0.60 && right.overshoot < 0.60, `excessive yaw overshoot at ${c.speed} km/h`);
}
console.log(JSON.stringify({ scenario: 'high-speed step-steer diagnostic', rows }, null, 2));
console.log('HighSpeedStepSteerDiagnostic: PASS');

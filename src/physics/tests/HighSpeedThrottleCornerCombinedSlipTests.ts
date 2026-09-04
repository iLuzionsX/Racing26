import assert from 'node:assert/strict';
import type { ControlInputs, VehicleConfig } from '../../types';
import { Simulation } from '../Simulation';
import { ProvingGroundSurfaceProvider } from '../SurfaceProvider';
import { DEFAULT_VEHICLE_CONFIG } from '../vehiclePresets';
import { BMW_M5_2025_OVERRIDES } from '../m5G90';
import { PhysicsMath } from '../math/PhysicsMath';

// Deterministic mirrored throttle-while-cornering combined-slip regression.
// Uses only normal Simulation.stepExplicit inputs; prescribes no pose/yaw/force.
// Canonical order [FL,FR,RL,RR], +X left/+Y up/+Z forward, +steer/yaw = left.
const DT = 1 / 120;
const DEG = 180 / Math.PI;
const neutral: ControlInputs = { throttle: 0, brake: 0, steer: 0, handbrake: false, shiftUp: false, shiftDown: false };
const config = { ...DEFAULT_VEHICLE_CONFIG, ...BMW_M5_2025_OVERRIDES, absMode: 'OFF', tcsMode: 'OFF' } as VehicleConfig;

function makeRolling(speedMs: number) {
  const sim = new Simulation(config, new ProvingGroundSurfaceProvider());
  sim.reset(0, 0, 0);
  for (let i = 0; i < 240; i++) sim.stepExplicit(neutral, 1);
  sim.vehicle.rigidBody.velocity = PhysicsMath.vec3(0, 0, speedMs);
  for (const w of sim.vehicle.wheels) w.reset(speedMs);
  sim.vehicle.powertrain.isAutomatic = false;
  sim.vehicle.powertrain.gear = 5;
  for (let i = 0; i < 60; i++) sim.stepExplicit(neutral, 1);
  return sim;
}

function steerForAy(targetAy: number, speedMs: number) {
  const delta = (targetAy * config.wheelbase) / Math.max(1, speedMs * speedMs);
  return PhysicsMath.clamp(delta / config.maxSteerAngle, -1, 1);
}

function ellipseUtil(mu: number, fz: number, fx: number, fy: number) {
  const denom = Math.max(50, mu * Math.max(50, fz));
  return Math.hypot(fx, fy) / denom;
}

function runCase(speedKmh: number, direction: 1 | -1) {
  const speedMs = speedKmh / 3.6;
  const sim = makeRolling(speedMs);
  const steer = steerForAy(6.0, speedMs) * direction;
  for (let i = 0; i < Math.round(1.0 / DT); i++) sim.stepExplicit({ ...neutral, steer }, 1);
  const pre = sim.vehicle.getState();
  const preRearFy = Math.abs(pre.wheels[2].forceVectorLat + pre.wheels[3].forceVectorLat);
  const preYaw = pre.yawRate * direction;
  assert(preYaw > 0, `${speedKmh} kmh dir ${direction}: no left-positive yaw established`);
  for (let i = 0; i < Math.round(1.5 / DT); i++) {
    const t = i / Math.max(1, Math.round(1.5 / DT) - 1);
    const throttle = 0.15 + 0.45 * Math.min(1, t / 0.6);
    sim.stepExplicit({ ...neutral, steer, throttle }, 1);
  }
  const post = sim.vehicle.getState();
  const rearFy = Math.abs(post.wheels[2].forceVectorLat + post.wheels[3].forceVectorLat);
  const frontFy = Math.abs(post.wheels[0].forceVectorLat + post.wheels[1].forceVectorLat);
  const rearFx = Math.abs(post.wheels[2].forceVectorLong + post.wheels[3].forceVectorLong);
  const muR = (config as any).tireGripRear ?? 1.2;
  const fzR = Math.max(1, post.wheels[2].forceVectorNorm + post.wheels[3].forceVectorNorm);
  const util = ellipseUtil(muR, fzR * 0.5, rearFx * 0.5, rearFy * 0.5);
  const v = sim.vehicle.rigidBody.getLocalVelocity();
  const sideslipDeg = Math.abs(Math.atan2(v.x, Math.max(1, Math.abs(v.z))) * DEG);
  const yawDegS = post.yawRate * DEG;
  const result = { speedKmh, direction, steer, preRearFy, rearFy, frontFy, rearFx, util, sideslipDeg, yawDegS, speedPostKmh: post.speedKmh };
  for (const [, vv] of Object.entries(result)) assert(Number.isFinite(vv), `non-finite ${speedKmh} ${direction}`);
  assert(rearFy > 800, `${speedKmh} dir ${direction}: rear lateral collapse Fy=${rearFy.toFixed(0)}N`);
  assert(rearFy > preRearFy * 0.35, `${speedKmh} dir ${direction}: rear Fy retention ${(rearFy / Math.max(1, preRearFy)).toFixed(2)}`);
  assert(util < 1.25, `${speedKmh} dir ${direction}: ellipse breach util=${util.toFixed(2)}`);
  assert(sideslipDeg < 8, `${speedKmh} dir ${direction}: sideslip ${sideslipDeg.toFixed(1)}deg`);
  assert(Math.abs(yawDegS) < 28, `${speedKmh} dir ${direction}: yaw ${yawDegS.toFixed(1)}deg/s`);
  return result;
}

const cases = [100, 140, 180].flatMap((v) => [runCase(v, 1), runCase(v, -1)]);
for (const speed of [100, 140, 180]) {
  const left = cases.find((c) => c.speedKmh === speed && c.direction === 1)!;
  const right = cases.find((c) => c.speedKmh === speed && c.direction === -1)!;
  const mirror = (a: number, b: number) => Math.abs(Math.abs(a) - Math.abs(b)) / Math.max(0.25, (Math.abs(a) + Math.abs(b)) * 0.5);
  assert(mirror(left.rearFy, right.rearFy) < 0.12, `${speed} kmh rearFy mirror drift`);
  assert(mirror(left.yawDegS, right.yawDegS) < 0.15, `${speed} kmh yaw mirror drift`);
  assert(mirror(left.sideslipDeg + 1, right.sideslipDeg + 1) < 0.25, `${speed} kmh sideslip mirror drift`);
}
console.log(JSON.stringify({ scenario: 'high-speed throttle-corner combined-slip', tcs: 'OFF', cases }, null, 2));
console.log('HighSpeedThrottleCornerCombinedSlipTests: PASS');

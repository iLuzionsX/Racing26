import assert from 'node:assert/strict';
import type { ControlInputs, VehicleConfig } from '../../types';
import { Simulation } from '../Simulation';
import { ProvingGroundSurfaceProvider } from '../SurfaceProvider';
import { DEFAULT_VEHICLE_CONFIG } from '../vehiclePresets';
import { BMW_M5_2025_OVERRIDES } from '../m5G90';
import { PhysicsMath } from '../math/PhysicsMath';
// Deterministic high-speed spin root-cause regression. Test-only: no physics tuning,
// no grip/damping/steering/assist changes, no hidden yaw damping or clamps.
// Fails on any high-speed turn spins out; passes only after true sign/control fix.
const DT = 1 / 120;
const DEG = 180 / Math.PI;
const SPEEDS_KMH = [100, 130, 160];
const STEP_INPUT = 0.10;
const STEP_SEC = 2.0;
const RELEASE_SEC = 1.0;
const neutral: ControlInputs = { throttle: 0.15, brake: 0, steer: 0, handbrake: false, shiftUp: false, shiftDown: false };
const config = { ...DEFAULT_VEHICLE_CONFIG, ...BMW_M5_2025_OVERRIDES } as VehicleConfig;
function makeRollingM5(speedKmh: number): Simulation {
  const sim = new Simulation(config, new ProvingGroundSurfaceProvider());
  sim.reset(0, 0, 0);
  for (let i = 0; i < 240; i++) sim.stepExplicit(neutral, 1);
  const v = speedKmh / 3.6;
  sim.vehicle.rigidBody.velocity = PhysicsMath.vec3(0, 0, v);
  for (const w of sim.vehicle.wheels) w.reset(v);
  sim.vehicle.powertrain.isAutomatic = false;
  sim.vehicle.powertrain.gear = 4;
  for (let i = 0; i < 60; i++) sim.stepExplicit(neutral, 1);
  return sim;
}
function sideslipDeg(sim: Simulation): number {
  const v = sim.vehicle.rigidBody.getLocalVelocity();
  return Math.atan2(v.x, Math.max(0.5, Math.abs(v.z))) * DEG;
}
function runMirroredStep(speedKmh: number, direction: 1 | -1) {
  const sim = makeRollingM5(speedKmh);
  const steer = STEP_INPUT * direction;
  let peakYaw = 0;
  let peakSlip = 0;
  let peakFrontSlip = 0;
  let peakRearSlip = 0;
  let peakRearKappa = 0;
  let peakLatG = 0;
  let minRearFz = Infinity;
  let maxClosureResidual = 0;
  let prevYawRate = sim.vehicle.getState().yawRate;
  const steps = Math.round(STEP_SEC / DT);
  for (let i = 0; i < steps; i++) {
    const s = sim.stepExplicit({ ...neutral, steer }, 1);
    const yaw = s.yawRate;
    const yawAccel = (yaw - prevYawRate) / DT;
    prevYawRate = yaw;
    peakYaw = Math.max(peakYaw, Math.abs(yaw));
    peakSlip = Math.max(peakSlip, Math.abs(sideslipDeg(sim)));
    peakFrontSlip = Math.max(peakFrontSlip, Math.abs(s.wheels[0].slipAngle) * DEG, Math.abs(s.wheels[1].slipAngle) * DEG);
    peakRearSlip = Math.max(peakRearSlip, Math.abs(s.wheels[2].slipAngle) * DEG, Math.abs(s.wheels[3].slipAngle) * DEG);
    peakRearKappa = Math.max(peakRearKappa, Math.abs(s.wheels[2].slipRatio), Math.abs(s.wheels[3].slipRatio));
    peakLatG = Math.max(peakLatG, Math.abs(s.lateralG));
    minRearFz = Math.min(minRearFz, s.wheels[2].forceVectorNorm, s.wheels[3].forceVectorNorm);
    const hp: any = (sim.vehicle as any).getHardpointsBody ? (sim.vehicle as any).getHardpointsBody() : [{ x: 0.84, z: 1.5 }, { x: -0.84, z: 1.5 }, { x: 0.83, z: -1.5 }, { x: -0.83, z: -1.5 }];
    let my = 0;
    for (let k = 0; k < 4; k++) {
      const rx = Number(hp[k].x) || 0;
      const rz = Number(hp[k].z) || 0;
      const flat = Number(s.wheels[k].forceVectorLat) || 0;
      const flong = Number(s.wheels[k].forceVectorLong) || 0;
      my += rz * flat - rx * flong;
    }
    const iz = Math.max(1000, Number((sim.vehicle.rigidBody.config as any).inertia.y) || 5800);
    const expectedAlpha = my / iz;
    maxClosureResidual = Math.max(maxClosureResidual, Math.abs(yawAccel - expectedAlpha));
    assert(Number.isFinite(s.yawRate) && Number.isFinite(peakSlip), 'non-finite high-speed state');
  }
  const held = sim.vehicle.getState();
  for (let i = 0; i < Math.round(RELEASE_SEC / DT); i++) sim.stepExplicit(neutral, 1);
  const released = sim.vehicle.getState();
  return { speedKmh, direction, steer, peakYawDegS: peakYaw * DEG, peakSlipDeg: peakSlip, peakFrontSlipDeg: peakFrontSlip, peakRearSlipDeg: peakRearSlip, peakRearKappa, peakLatG, minRearFzN: minRearFz, maxClosureResidual, heldYawDegS: Math.abs(held.yawRate) * DEG, releasedYawDegS: Math.abs(released.yawRate) * DEG, finalState: released };
}
const rows: Array<ReturnType<typeof runMirroredStep>> = [];
for (const v of SPEEDS_KMH) {
  const left = runMirroredStep(v, 1);
  const right = runMirroredStep(v, -1);
  rows.push(left, right);
  const mirrorYaw = Math.abs(Math.abs(left.peakYawDegS) - Math.abs(right.peakYawDegS)) / Math.max(1, (Math.abs(left.peakYawDegS) + Math.abs(right.peakYawDegS)) * 0.5);
  const mirrorSlip = Math.abs(left.peakSlipDeg - right.peakSlipDeg) / Math.max(0.5, (left.peakSlipDeg + right.peakSlipDeg) * 0.5);
  console.log(JSON.stringify({ speedKmh: v, left, right, mirrorYaw, mirrorSlip }));
  assert(mirrorYaw < 0.12, `${v} km/h left/right yaw not mirrored: L=${left.peakYawDegS.toFixed(1)} R=${right.peakYawDegS.toFixed(1)}`);
  assert(mirrorSlip < 0.25, `${v} km/h left/right sideslip not mirrored`);
}
for (const r of rows) {
  assert(r.peakSlipDeg < 8, `${r.speedKmh} km/h spin: sideslip ${r.peakSlipDeg.toFixed(1)} deg`);
  assert(r.peakFrontSlipDeg < 12 && r.peakRearSlipDeg < 12, `${r.speedKmh} km/h tire gross slide F=${r.peakFrontSlipDeg.toFixed(1)} R=${r.peakRearSlipDeg.toFixed(1)} deg`);
  assert(r.peakYawDegS < 55, `${r.speedKmh} km/h yaw runaway ${r.peakYawDegS.toFixed(1)} deg/s`);
  assert(r.minRearFzN > 800, `${r.speedKmh} km/h rear unloaded to ${r.minRearFzN.toFixed(0)} N`);
  assert(r.maxClosureResidual < 3.0, `${r.speedKmh} km/h yaw-moment closure residual ${r.maxClosureResidual.toFixed(2)} rad/s2`);
  assert(r.releasedYawDegS < r.heldYawDegS * 0.6 + 2, `${r.speedKmh} km/h yaw did not decay after release`);
}
console.log('HighSpeedSpinRootCauseRegression: PASS');

import assert from 'node:assert/strict';
import type { ControlInputs, VehicleConfig } from '../../types';
import { Simulation } from '../Simulation';
import { ProvingGroundSurfaceProvider } from '../SurfaceProvider';
import { DEFAULT_VEHICLE_CONFIG } from '../vehiclePresets';
import { BMW_M5_2025_OVERRIDES } from '../m5G90';
import { updateDigitalSteeringInput } from '../DigitalSteeringInput';
// Deterministic high-speed keyboard cornering gate (Racing26).
// Measures normal behavior only: no test-only forces, grip, yaw or steering overrides.
// Canonical: wheel order [FL,FR,RL,RR], +X left/+Y up/+Z forward, +steer/+yaw = left.
// Intentionally does NOT require digital hold to reach full mechanical lock at speed.
// Separate direct-rack check preserves emergency countersteer authority.
const DT = 1 / 120;
const DEG = 180 / Math.PI;
const SPEEDS_KMH = [40, 70, 100, 120];
const HOLD_SEC = 2.0;
const TAP_HOLD_SEC = 0.15;
const RELEASE_SEC = 1.0;
const USEFUL_SLIP_MEAN_DEG = 12.0;
const USEFUL_SLIP_PEAK_DEG = 20.0;
const config = { ...DEFAULT_VEHICLE_CONFIG, ...BMW_M5_2025_OVERRIDES } as VehicleConfig;
const neutral: ControlInputs = { throttle: 0, brake: 0, steer: 0, handbrake: false, shiftUp: false, shiftDown: false };
function makeRollingM5(speedMs: number): Simulation {
  const sim = new Simulation(config, new ProvingGroundSurfaceProvider());
  sim.reset(0, 0, 0);
  sim.vehicle.powertrain.isAutomatic = false;
  (sim.vehicle.powertrain as any).gear = 0;
  for (let i = 0; i < 240; i++) sim.stepExplicit(neutral, 1);
  sim.vehicle.rigidBody.velocity.x = 0;
  sim.vehicle.rigidBody.velocity.z = speedMs;
  for (const w of sim.vehicle.wheels) w.reset(speedMs);
  for (let i = 0; i < 60; i++) sim.stepExplicit(neutral, 1);
  return sim;
}
function wheelUtil(w: any): number {
  const c = w.gripUtilization ?? w.combinedSlipUtilization ?? w.skidIntensity ?? 0;
  return Number.isFinite(c) ? c : 0;
}
function runDigitalHold(speedKmh: number, direction: 1 | -1) {
  const speedMs = speedKmh / 3.6;
  const sim = makeRollingM5(speedMs);
  let digital = 0;
  const steps = Math.round(HOLD_SEC / DT);
  let peakDigital = 0;
  let peakFrontSlipDeg = 0;
  let peakLatG = 0;
  const late: any[] = [];
  let finalState: any = null;
  for (let s = 0; s < steps; s++) {
    const v = Math.abs(sim.vehicle.rigidBody.getLocalVelocity().z);
    digital = updateDigitalSteeringInput(digital, direction, v, DT);
    peakDigital = Math.max(peakDigital, Math.abs(digital));
    finalState = sim.stepExplicit({ ...neutral, steer: digital }, 1);
    const fSlip = Math.max(Math.abs(finalState.wheels[0].slipAngle), Math.abs(finalState.wheels[1].slipAngle)) * DEG;
    peakFrontSlipDeg = Math.max(peakFrontSlipDeg, fSlip);
    peakLatG = Math.max(peakLatG, Math.abs(finalState.lateralG));
    if (s >= steps - Math.round(0.75 / DT)) {
      const spd = Math.hypot(finalState.vx, finalState.vz);
      const yaw = sim.vehicle.rigidBody.getLocalAngularVelocity().y;
      late.push({ digital, centerDeg: finalState.actualSteerAngle * DEG, fSlipDeg: fSlip, rSlipDeg: Math.max(Math.abs(finalState.wheels[2].slipAngle), Math.abs(finalState.wheels[3].slipAngle)) * DEG, fyF: finalState.wheels[0].forceVectorLat + finalState.wheels[1].forceVectorLat, utilF: Math.max(wheelUtil(finalState.wheels[0]), wheelUtil(finalState.wheels[1])), yawRadS: yaw, latG: finalState.lateralG, speedMs: spd, x: finalState.x, z: finalState.z, fz: finalState.wheels.map((w: any) => w.suspensionForce ?? w.forceVectorNorm) });
    }
  }
  const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
  const mDigital = mean(late.map((l) => Math.abs(l.digital)));
  const mCenter = mean(late.map((l) => Math.abs(l.centerDeg)));
  const mFSlip = mean(late.map((l) => l.fSlipDeg));
  const mYaw = mean(late.map((l) => Math.abs(l.yawRadS)));
  const mLatG = mean(late.map((l) => Math.abs(l.latG)));
  const mSpeed = mean(late.map((l) => l.speedMs));
  const radiusM = mYaw > 0.02 ? mSpeed / mYaw : Number.POSITIVE_INFINITY;
  return { speedKmh, direction, peakDigital, peakFrontSlipDeg, peakLatG, lateMeanDigital: mDigital, lateMeanCenterDeg: mCenter, lateMeanFrontSlipDeg: mFSlip, lateMeanYawDegS: mYaw * DEG, lateMeanLatG: mLatG, lateMeanRadiusM: radiusM, finalX: finalState.x, finalZ: finalState.z, finalSpeedKmh: finalState.speedKmh, late };
}
function runTapRelease(speedKmh: number, direction: 1 | -1) {
  const sim = makeRollingM5(speedKmh / 3.6);
  let digital = 0;
  const tapSteps = Math.round(TAP_HOLD_SEC / DT);
  const relSteps = Math.round(RELEASE_SEC / DT);
  let peakYaw = 0;
  for (let s = 0; s < tapSteps; s++) {
    const v = Math.abs(sim.vehicle.rigidBody.getLocalVelocity().z);
    digital = updateDigitalSteeringInput(digital, direction, v, DT);
    const st = sim.stepExplicit({ ...neutral, steer: digital }, 1);
    peakYaw = Math.max(peakYaw, Math.abs(st.yawRate));
  }
  for (let s = 0; s < relSteps; s++) {
    const v = Math.abs(sim.vehicle.rigidBody.getLocalVelocity().z);
    digital = updateDigitalSteeringInput(digital, 0, v, DT);
    sim.stepExplicit({ ...neutral, steer: digital }, 1);
  }
  const end = sim.vehicle.getState();
  return { speedKmh, direction, releasedDigital: digital, peakYawDegS: peakYaw * DEG, residualYawDegS: Math.abs(end.yawRate) * DEG };
}
function checkDirectRackAuthority() {
  // Emergency countersteer must retain full mechanical rack via direct analog request.
  // This is independent of any future keyboard speed shaping and must keep passing.
  for (const dir of [1, -1] as const) {
    const sim = makeRollingM5(100 / 3.6);
    const aids = sim.vehicle.driverAids;
    aids.reset();
    let center = 0;
    for (let i = 0; i < 180; i++) center = aids.updateSteering(dir, 100 / 3.6, DT).centerAngle;
    const maxDeg = (config as any).maxSteerAngle * DEG;
    assert(Math.abs(Math.abs(center) * DEG - maxDeg) < 0.5, `direct rack authority lost: dir=${dir} center=${(center * DEG).toFixed(2)}deg max=${maxDeg.toFixed(2)}deg`);
  }
}
const holds: any[] = [];
for (const v of SPEEDS_KMH) {
  const left = runDigitalHold(v, 1);
  const right = runDigitalHold(v, -1);
  holds.push({ speedKmh: v, left, right });
  // Mirrored left/right invariant: equal magnitude, opposite sign trajectory/yaw.
  assert(Math.abs(left.peakDigital - 1) < 1e-12 && Math.abs(right.peakDigital - 1) < 1e-12, `${v}km/h digital hold must slew to full request`);
  // Digital path must never exceed physical rack; full lock is allowed but never required here.
  const maxDeg = (config as any).maxSteerAngle * DEG;
  assert(left.lateMeanCenterDeg <= maxDeg + 0.5 && right.lateMeanCenterDeg <= maxDeg + 0.5, `${v}km/h center exceeded mechanical rack`);
  const yawTol = Math.max(0.02, 0.05 * Math.max(left.lateMeanYawDegS, right.lateMeanYawDegS));
  assert(Math.abs(left.lateMeanYawDegS - right.lateMeanYawDegS) <= yawTol + 0.5, `${v}km/h yaw failed mirror: L=${left.lateMeanYawDegS.toFixed(2)} R=${right.lateMeanYawDegS.toFixed(2)}`);
  assert(Math.abs(left.finalX + right.finalX) <= Math.max(1.0, 0.08 * Math.max(Math.abs(left.finalX), Math.abs(right.finalX))), `${v}km/h trajectory failed mirror: Lx=${left.finalX.toFixed(2)} Rx=${right.finalX.toFixed(2)}`);
  assert(Math.abs(left.lateMeanFrontSlipDeg - right.lateMeanFrontSlipDeg) <= Math.max(0.5, 0.08 * Math.max(left.lateMeanFrontSlipDeg, right.lateMeanFrontSlipDeg)), `${v}km/h front slip failed mirror`);
  // Useful response: car must actually turn, stay finite, stay on wheels.
  const minYaw = v <= 45 ? 3.0 : v <= 75 ? 2.0 : 1.5;
  assert(left.lateMeanYawDegS > minYaw && right.lateMeanYawDegS > minYaw, `${v}km/h produced no useful yaw: L=${left.lateMeanYawDegS.toFixed(2)} R=${right.lateMeanYawDegS.toFixed(2)}`);
  assert(Number.isFinite(left.lateMeanRadiusM) && left.lateMeanRadiusM > 5 && left.lateMeanRadiusM < 800, `${v}km/h radius implausible: ${left.lateMeanRadiusM}`);
  assert(left.lateMeanLatG < 1.35 && right.lateMeanLatG < 1.35, `${v}km/h lateral G implausible`);
  // Saturation / over-command gate: front slip beyond useful tire range while holding full digital request.
  // Do not fix by raising tireGripFront/Rear, stiffness, or assists; fix steering demand or diagnose tire curve.
  assert(left.lateMeanFrontSlipDeg < USEFUL_SLIP_MEAN_DEG, `${v}km/h LEFT over-command: front slip ${left.lateMeanFrontSlipDeg.toFixed(1)}deg > ${USEFUL_SLIP_MEAN_DEG}deg with center ${left.lateMeanCenterDeg.toFixed(1)}deg yaw ${left.lateMeanYawDegS.toFixed(1)}deg/s latG ${left.lateMeanLatG.toFixed(2)}g radius ${left.lateMeanRadiusM.toFixed(1)}m`);
  assert(right.lateMeanFrontSlipDeg < USEFUL_SLIP_MEAN_DEG, `${v}km/h RIGHT over-command: front slip ${right.lateMeanFrontSlipDeg.toFixed(1)}deg > ${USEFUL_SLIP_MEAN_DEG}deg`);
  assert(left.peakFrontSlipDeg < USEFUL_SLIP_PEAK_DEG && right.peakFrontSlipDeg < USEFUL_SLIP_PEAK_DEG, `${v}km/h front slip peak saturated`);
}
for (const v of SPEEDS_KMH) {
  for (const dir of [1, -1] as const) {
    const tap = runTapRelease(v, dir);
    assert(Math.abs(tap.releasedDigital) < 1e-12, `${v}km/h tap did not release to center`);
    assert(tap.residualYawDegS < Math.max(2.0, tap.peakYawDegS * 0.6), `${v}km/h tap yaw did not unwind: peak=${tap.peakYawDegS.toFixed(1)} residual=${tap.residualYawDegS.toFixed(1)}`);
  }
}
checkDirectRackAuthority();
console.log(JSON.stringify({ scenario: 'M5 high-speed keyboard cornering gate', speedsKmh: SPEEDS_KMH, holdSec: HOLD_SEC, tapSec: TAP_HOLD_SEC, releaseSec: RELEASE_SEC, usefulSlipMeanDeg: USEFUL_SLIP_MEAN_DEG, usefulSlipPeakDeg: USEFUL_SLIP_PEAK_DEG, holds: holds.map((h) => ({ speedKmh: h.speedKmh, left: { peakDigital: h.left.peakDigital, centerDeg: h.left.lateMeanCenterDeg, frontSlipDeg: h.left.lateMeanFrontSlipDeg, peakSlipDeg: h.left.peakFrontSlipDeg, yawDegS: h.left.lateMeanYawDegS, latG: h.left.lateMeanLatG, radiusM: h.left.lateMeanRadiusM, x: h.left.finalX }, right: { peakDigital: h.right.peakDigital, centerDeg: h.right.lateMeanCenterDeg, frontSlipDeg: h.right.lateMeanFrontSlipDeg, peakSlipDeg: h.right.peakFrontSlipDeg, yawDegS: h.right.lateMeanYawDegS, latG: h.right.lateMeanLatG, radiusM: h.right.lateMeanRadiusM, x: h.right.finalX } })), status: 'passed' }, null, 2));
console.log('HighSpeedKeyboardCorneringTests: PASS');

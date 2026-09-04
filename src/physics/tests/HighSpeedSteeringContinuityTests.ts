import assert from 'node:assert/strict';
import type { ControlInputs, VehicleConfig } from '../../types';
import { Simulation } from '../Simulation';
import { ProvingGroundSurfaceProvider } from '../SurfaceProvider';
import { DEFAULT_VEHICLE_CONFIG } from '../vehiclePresets';
import { BMW_M5_2025_OVERRIDES } from '../m5G90';
import { PhysicsMath } from '../math/PhysicsMath';
import { updateDigitalSteeringInput } from '../DigitalSteeringInput';
// Deterministic high-speed steering characterization: 100-180 km/h mirrored
// ramp-step, hold, countersteer reversal, and release. Uses only normal
// simulation inputs (initial velocity, throttle/brake/steer). No pose/yaw/force
// grip/damping overrides. Canonical: +steer/+yaw = left, wheels [FL,FR,RL,RR].
const DT = 1 / 120;
const DEG = 180 / Math.PI;
const neutral: ControlInputs = { throttle: 0, brake: 0, steer: 0, handbrake: false, shiftUp: false, shiftDown: false };
const config = { ...DEFAULT_VEHICLE_CONFIG, ...BMW_M5_2025_OVERRIDES, absMode: 'OFF', tcsMode: 'OFF' } as VehicleConfig;
function makeHighSpeedM5(speedKmh: number): Simulation {
  const sim = new Simulation(config, new ProvingGroundSurfaceProvider());
  sim.reset(0, 0, 0);
  sim.vehicle.powertrain.isAutomatic = false;
  sim.vehicle.powertrain.gear = 0;
  for (let i = 0; i < 240; i++) sim.stepExplicit(neutral, 1);
  const v = speedKmh / 3.6;
  sim.vehicle.rigidBody.velocity = PhysicsMath.vec3(0, 0, v);
  for (const w of sim.vehicle.wheels) w.reset(v);
  for (let i = 0; i < 60; i++) sim.stepExplicit(neutral, 1);
  return sim;
}
function sideslipDeg(sim: Simulation): number {
  const lv = sim.vehicle.rigidBody.getLocalVelocity();
  return Math.atan2(lv.x, Math.max(0.5, Math.abs(lv.z))) * DEG;
}
type Summary = { speedKmh: number; dir: 1 | -1; peakYawDegS: number; peakSideslipDeg: number; peakFrontSlipDeg: number; peakRearSlipDeg: number; peakRollDeg: number; peakLatG: number; minWheelLoadN: number; airborne: number; finalYawDegS: number; spun: boolean };
function runHold(speedKmh: number, dir: 1 | -1, steer: number, holdSec: number): Summary {
  const sim = makeHighSpeedM5(speedKmh);
  const steps = Math.round(holdSec / DT);
  let peakYaw = 0; let peakBeta = 0; let peakFront = 0; let peakRear = 0; let peakRoll = 0; let peakG = 0; let minLoad = Infinity; let airborne = 0;
  // 0.25s linear ramp avoids testing the 120Hz step discontinuity itself.
  const rampSteps = Math.round(0.25 / DT);
  for (let i = 0; i < steps; i++) {
    const r = Math.min(1, (i + 1) / Math.max(1, rampSteps));
    const st = sim.stepExplicit({ ...neutral, steer: dir * steer * r }, 1);
    const yawD = Math.abs(st.yawRate * DEG);
    peakYaw = Math.max(peakYaw, yawD);
    peakBeta = Math.max(peakBeta, Math.abs(sideslipDeg(sim)));
    peakFront = Math.max(peakFront, Math.max(Math.abs(st.wheels[0].slipAngle), Math.abs(st.wheels[1].slipAngle)) * DEG);
    peakRear = Math.max(peakRear, Math.max(Math.abs(st.wheels[2].slipAngle), Math.abs(st.wheels[3].slipAngle)) * DEG);
    peakRoll = Math.max(peakRoll, Math.abs(st.roll * DEG));
    peakG = Math.max(peakG, Math.abs(st.lateralG));
    for (const w of st.wheels) minLoad = Math.min(minLoad, w.forceVectorNorm);
    if (st.wheels.some((w) => w.isAirborne)) airborne++;
    assert(Number.isFinite(st.yawRate) && Number.isFinite(st.roll), `non-finite at ${speedKmh}km/h`);
  }
  const end = sim.vehicle.getState();
  const spun = peakBeta > 12 || peakYaw > 35 || peakRoll > 8 || airborne > 0;
  return { speedKmh, dir, peakYawDegS: peakYaw, peakSideslipDeg: peakBeta, peakFrontSlipDeg: peakFront, peakRearSlipDeg: peakRear, peakRollDeg: peakRoll, peakLatG: peakG, minWheelLoadN: minLoad, airborne, finalYawDegS: Math.abs(end.yawRate * DEG), spun };
}
function mirrorErr(a: number, b: number): number {
  return Math.abs(Math.abs(a) - Math.abs(b)) / Math.max(0.5, (Math.abs(a) + Math.abs(b)) * 0.5);
}
const SPEEDS = [100, 130, 160];
const SMALL_STEER = 0.05;
const results: Summary[] = [];
for (const v of SPEEDS) {
  const left = runHold(v, 1, SMALL_STEER, 2.5);
  const right = runHold(v, -1, SMALL_STEER, 2.5);
  results.push(left, right);
  console.log(JSON.stringify({ hold2p5s: left }));
  console.log(JSON.stringify({ hold2p5s: right }));
  assert(mirrorErr(left.peakYawDegS, right.peakYawDegS) < 0.12, `${v}km/h yaw mirror drift L=${left.peakYawDegS.toFixed(1)} R=${right.peakYawDegS.toFixed(1)}`);
  assert(mirrorErr(left.peakSideslipDeg, right.peakSideslipDeg) < 0.20, `${v}km/h sideslip mirror drift`);
  assert(mirrorErr(left.peakLatG, right.peakLatG) < 0.12, `${v}km/h latG mirror drift`);
  // Small high-speed turn must be near-limit but not an instant spin. If the
  // reported defect reproduces, this fails with sideslip/yaw/roll blow-up.
  assert(!left.spun, `${v}km/h LEFT small turn spun: yaw=${left.peakYawDegS.toFixed(1)} beta=${left.peakSideslipDeg.toFixed(1)} front=${left.peakFrontSlipDeg.toFixed(1)} rear=${left.peakRearSlipDeg.toFixed(1)}`);
  assert(!right.spun, `${v}km/h RIGHT small turn spun`);
  assert(left.minWheelLoadN > 800, `${v}km/h inside unloaded to ${left.minWheelLoadN.toFixed(0)}N`);
}
// Countersteer authority + release continuity at 130 km/h via real digital path.
{
  const sim = makeHighSpeedM5(130);
  let dig = 0;
  for (let i = 0; i < Math.round(0.6 / DT); i++) { dig = updateDigitalSteeringInput(dig, 1, sim.vehicle.rigidBody.getLocalVelocity().z, DT); sim.stepExplicit({ ...neutral, steer: dig }, 1); }
  const preYaw = Math.abs(sim.vehicle.getState().yawRate * DEG);
  let peakCounter = 0;
  for (let i = 0; i < Math.round(0.6 / DT); i++) { dig = updateDigitalSteeringInput(dig, -1, sim.vehicle.rigidBody.getLocalVelocity().z, DT); peakCounter = Math.max(peakCounter, -dig); const st = sim.stepExplicit({ ...neutral, steer: dig }, 1); assert(Number.isFinite(st.yawRate), 'countersteer non-finite'); }
  assert(peakCounter > 0.8, `high-speed countersteer withheld: ${peakCounter.toFixed(3)}`);
  let rel = dig;
  for (let i = 0; i < Math.round(1.0 / DT); i++) { rel = updateDigitalSteeringInput(rel, 0, sim.vehicle.rigidBody.getLocalVelocity().z, DT); sim.stepExplicit({ ...neutral, steer: rel }, 1); }
  const fin = sim.vehicle.getState();
  assert(Math.abs(fin.yawRate * DEG) < Math.max(6, preYaw * 0.5), `release did not settle: pre=${preYaw.toFixed(1)} final=${(Math.abs(fin.yawRate * DEG)).toFixed(1)}`);
  console.log(JSON.stringify({ counter130: { preYawDegS: preYaw, peakCounter: peakCounter, finalYawDegS: Math.abs(fin.yawRate * DEG) } }));
}
console.log('HighSpeedSteeringContinuityTests: PASS');

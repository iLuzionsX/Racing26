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
const config = { ...DEFAULT_VEHICLE_CONFIG, ...BMW_M5_2025_OVERRIDES } as VehicleConfig;

function centerDegToInput(centerDeg: number): number {
  const maxSteer = Number((config as any).maxSteerAngle ?? 0.58);
  return (centerDeg * Math.PI / 180) / maxSteer;
}

function sideslipDeg(sim: Simulation): number {
  const v = sim.vehicle.rigidBody.getLocalVelocity();
  return Math.atan2(v.x, Math.max(0.5, Math.abs(v.z))) * DEG;
}

function makeRollingSim(speedMs: number): Simulation {
  const sim = new Simulation(config, new ProvingGroundSurfaceProvider());
  sim.reset(0, 0, 0);
  sim.vehicle.powertrain.isAutomatic = false;
  (sim.vehicle.powertrain as any).gear = 0;
  for (let i = 0; i < 240; i++) sim.stepExplicit(neutral, 1);
  sim.vehicle.rigidBody.velocity = PhysicsMath.vec3(0, 0, speedMs);
  for (const wheel of sim.vehicle.wheels) wheel.reset(speedMs);
  for (let i = 0; i < 60; i++) sim.stepExplicit(neutral, 1);
  return sim;
}

function mirrorError(a: number, b: number): number {
  return Math.abs(Math.abs(a) - Math.abs(b)) / Math.max(0.25, (Math.abs(a) + Math.abs(b)) * 0.5);
}

function runDirection(speedKmh: number, centerDeg: number, direction: 1 | -1) {
  const speedMs = speedKmh / 3.6;
  const sim = makeRollingSim(speedMs);
  const steer = centerDegToInput(centerDeg) * direction;
  const rampSteps = Math.round(0.25 / DT);
  const holdSteps = Math.round(2.5 / DT);
  let maxYaw = 0;
  let maxSlipDeg = 0;
  let maxRollDeg = 0;
  let maxAlpha = 0;
  const tailYaw: number[] = [];
  const tailLatG: number[] = [];
  const tailFrontSlip: number[] = [];
  let tailLeftFz = 0;
  let tailRightFz = 0;
  let tailSamples = 0;
  let frontSteerDeg = 0;
  let rearSteerDeg: number | null = null;
  for (let step = 0; step < rampSteps + holdSteps; step++) {
    const ramp = Math.min(1, (step + 1) / Math.max(1, rampSteps));
    const state: any = sim.stepExplicit({ ...neutral, steer: steer * ramp }, 1);
    assert(Number.isFinite(state.yawRate) && Number.isFinite(state.roll), 'non-finite chassis state');
    const yawDegS = Math.abs(state.yawRate * DEG);
    const slipDeg = Math.abs(sideslipDeg(sim));
    maxYaw = Math.max(maxYaw, yawDegS);
    maxSlipDeg = Math.max(maxSlipDeg, slipDeg);
    maxRollDeg = Math.max(maxRollDeg, Math.abs(state.roll * DEG));
    const alpha = (sim.vehicle.rigidBody as any).angularAcceleration;
    if (alpha && Number.isFinite(alpha.y)) maxAlpha = Math.max(maxAlpha, Math.abs(alpha.y) * DEG);
    for (const w of state.wheels) {
      assert(Number.isFinite(w.slipAngle) && Number.isFinite(w.forceVectorNorm), 'non-finite wheel state');
      assert(w.verticalTravelM <= 0.140001 && w.verticalTravelM >= -0.120001, 'travel limit exceeded');
    }
    assert(state.wheels.every((w: any) => !w.isAirborne), 'high-speed step-steer lifted a wheel');
    if (step >= rampSteps + holdSteps - 60) {
      tailYaw.push(state.yawRate * DEG);
      tailLatG.push(Math.abs(state.lateralG));
      tailFrontSlip.push(Math.max(Math.abs(state.wheels[0].slipAngle), Math.abs(state.wheels[1].slipAngle)) * DEG);
      tailLeftFz += state.wheels[0].forceVectorNorm + state.wheels[2].forceVectorNorm;
      tailRightFz += state.wheels[1].forceVectorNorm + state.wheels[3].forceVectorNorm;
      tailSamples++;
      frontSteerDeg = (state.wheels[0].steerAngle + state.wheels[1].steerAngle) * 0.5 * DEG;
      const rear = (state.wheels[2].steerAngle + state.wheels[3].steerAngle) * 0.5 * DEG;
      if (Number.isFinite(rear)) rearSteerDeg = rear;
    }
  }
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
  const tailYawMean = mean(tailYaw);
  return { speedKmh, centerDeg, direction, steer, maxYawDegS: maxYaw, maxSideslipDeg: maxSlipDeg, maxRollDeg, maxAlphaDegS2: maxAlpha, tailYawMeanDegS: tailYawMean, tailLatGMean: mean(tailLatG), tailFrontSlipMeanDeg: mean(tailFrontSlip), tailLeftFzN: tailLeftFz / Math.max(1, tailSamples), tailRightFzN: tailRightFz / Math.max(1, tailSamples), frontSteerDeg, rearSteerDeg, absActive: Boolean((sim.vehicle as any).driverAids?.absActive), tcsActive: Boolean((sim.vehicle as any).driverAids?.tcsActive) };
}

const cases = [
  { speedKmh: 120, centerDeg: 1.0 },
  { speedKmh: 150, centerDeg: 0.7 },
  { speedKmh: 180, centerDeg: 0.5 },
];
const results: any[] = [];
for (const c of cases) {
  const left = runDirection(c.speedKmh, c.centerDeg, 1);
  const right = runDirection(c.speedKmh, c.centerDeg, -1);
  results.push({ ...c, left, right });
  for (const [label, r] of [['left', left], ['right', right]] as const) {
    assert(r.maxYawDegS < 40, `${c.speedKmh}km/h ${label} yaw diverged into spin: ${r.maxYawDegS.toFixed(1)}deg/s`);
    assert(r.maxSideslipDeg < 8, `${c.speedKmh}km/h ${label} sideslip exceeded skidpad validity: ${r.maxSideslipDeg.toFixed(1)}deg`);
    assert(r.maxRollDeg < 8, `${c.speedKmh}km/h ${label} roll excessive: ${r.maxRollDeg.toFixed(1)}deg`);
    assert(r.maxAlphaDegS2 < 300, `${c.speedKmh}km/h ${label} yaw acceleration unstable: ${r.maxAlphaDegS2.toFixed(1)}deg/s2`);
    assert(Math.sign(r.tailYawMeanDegS) === r.direction, `${c.speedKmh}km/h ${label} yaw sign does not follow left-positive steering`);
    if (r.direction > 0) assert(r.tailRightFzN > r.tailLeftFzN, `${c.speedKmh}km/h left turn must load right/outside`);
    else assert(r.tailLeftFzN > r.tailRightFzN, `${c.speedKmh}km/h right turn must load left/outside`);
    assert(!r.absActive && !r.tcsActive, `${c.speedKmh}km/h ${label} coasted turn should not need ABS/TCS`);
    if (r.rearSteerDeg !== null && Math.abs(r.frontSteerDeg) > 0.15) {
      assert(Math.sign(r.rearSteerDeg) === Math.sign(r.frontSteerDeg), `${c.speedKmh}km/h ${label} rear steer must be same-phase at high speed: front=${r.frontSteerDeg.toFixed(2)} rear=${r.rearSteerDeg.toFixed(2)}`);
    }
  }
  assert(mirrorError(left.tailYawMeanDegS, right.tailYawMeanDegS) < 0.12, `${c.speedKmh}km/h yaw left/right mirror drifted`);
  assert(mirrorError(left.tailLatGMean, right.tailLatGMean) < 0.12, `${c.speedKmh}km/h latG left/right mirror drifted`);
  assert(mirrorError(left.tailFrontSlipMeanDeg, right.tailFrontSlipMeanDeg) < 0.15, `${c.speedKmh}km/h front-slip mirror drifted`);
}
console.log(JSON.stringify({ scenario: 'M5 high-speed mirrored step-steer 120/150/180 coasted, sub-limit road-wheel demand', cases: results }, null, 2));
console.log('HighSpeedStepSteerMirrorTests: PASS');

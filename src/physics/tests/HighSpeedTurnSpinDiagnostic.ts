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
const steerInputForCenterDeg = (deg: number) => (deg / DEG) / (config as any).maxSteerAngle;

function sideslipDeg(sim: Simulation): number {
  const v = sim.vehicle.rigidBody.getLocalVelocity();
  return Math.atan2(v.x, Math.max(0.5, Math.abs(v.z))) * DEG;
}

function tireYawMomentNm(state: any, hardpoints: any[]): { total: number; perWheel: number[] } {
  const perWheel = state.wheels.map((w: any, i: number) => {
    const hp = hardpoints[i] ?? (w.localPos ?? { x: 0, z: 0 });
    const flat: number = w.forceVectorLat ?? 0;
    const flong: number = w.forceVectorLong ?? 0;
    return (hp.z ?? 0) * flat - (hp.x ?? 0) * flong;
  });
  return { total: perWheel.reduce((a: number, b: number) => a + b, 0), perWheel };
}

function runStepSteer(speedKmh: number, centerDeg: number, direction: 1 | -1) {
  const sim = new Simulation(config, new ProvingGroundSurfaceProvider());
  sim.reset(0, 0, 0);
  for (let i = 0; i < 240; i++) sim.stepExplicit(neutral, 1);
  const speedMs = speedKmh / 3.6;
  sim.vehicle.rigidBody.velocity = PhysicsMath.vec3(0, 0, speedMs);
  for (const w of sim.vehicle.wheels) w.reset(speedMs);
  sim.vehicle.powertrain.isAutomatic = false;
  (sim.vehicle.powertrain as any).gear = 0;
  for (let i = 0; i < 60; i++) sim.stepExplicit(neutral, 1);
  const target = steerInputForCenterDeg(centerDeg) * direction;
  const rampSteps = Math.round(0.30 / DT);
  const holdSteps = Math.round(3.0 / DT);
  let peakYawDegS = 0;
  let peakSideslipDeg = 0;
  let peakFrontSlipDeg = 0;
  let peakRearSlipDeg = 0;
  let spinSamples = 0;
  let maxLatG = 0;
  const tail: any[] = [];
  for (let step = 0; step < rampSteps + holdSteps; step++) {
    const ramp = Math.min(1, (step + 1) / Math.max(1, rampSteps));
    const state: any = sim.stepExplicit({ ...neutral, steer: target * ramp }, 1);
    assert(Number.isFinite(state.yawRate) && Number.isFinite(state.lateralG), 'non-finite high-speed state');
    const yawDegS = Math.abs(state.yawRate) * DEG;
    const beta = Math.abs(sideslipDeg(sim));
    const frontSlip = Math.max(Math.abs(state.wheels[0].slipAngle), Math.abs(state.wheels[1].slipAngle)) * DEG;
    const rearSlip = Math.max(Math.abs(state.wheels[2].slipAngle), Math.abs(state.wheels[3].slipAngle)) * DEG;
    peakYawDegS = Math.max(peakYawDegS, yawDegS);
    peakSideslipDeg = Math.max(peakSideslipDeg, beta);
    peakFrontSlipDeg = Math.max(peakFrontSlipDeg, frontSlip);
    peakRearSlipDeg = Math.max(peakRearSlipDeg, rearSlip);
    maxLatG = Math.max(maxLatG, Math.abs(state.lateralG));
    if (beta > 8 || yawDegS > 35) spinSamples++;
    if (step >= rampSteps + holdSteps - Math.round(0.5 / DT)) {
      const hps = (sim.vehicle as any).getHardpointsBody ? (sim.vehicle as any).getHardpointsBody() : [];
      tail.push({ state, beta, yawDegS, ym: tireYawMomentNm(state, hps) });
    }
  }
  const last = (sim.vehicle.getState() as any);
  const hps = (sim.vehicle as any).getHardpointsBody ? (sim.vehicle as any).getHardpointsBody() : [];
  const ym = tireYawMomentNm(last, hps);
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
  return {
    speedKmh, centerDeg, direction, steerInput: target, peakYawDegS, peakSideslipDeg,
    peakFrontSlipDeg, peakRearSlipDeg, maxLatG, spinSamples, yawMomentNm: ym.total,
    tailYawDegS: mean(tail.map((t) => t.yawDegS)),
    tailBetaDeg: mean(tail.map((t) => t.beta)),
    tailLatG: mean(tail.map((t) => Math.abs(t.state.lateralG))),
    tailLoadsN: [0, 1, 2, 3].map((i) => mean(tail.map((t) => t.state.wheels[i].forceVectorNorm))),
    tailGrip: [0, 1, 2, 3].map((i) => mean(tail.map((t) => Number(t.state.wheels[i].gripUtilization ?? 0)))),
    tailTempC: [0, 1, 2, 3].map((i) => mean(tail.map((t) => Number((t.state.wheels[i] as any).temperature ?? 0)))),
    finalRearSteerDeg: Number((last as any).rearSteerAngleDeg ?? (last as any).rearSteerAngle ?? 0),
    finalSteerDeg: Number(last.actualSteerAngle ?? 0) * DEG,
    finalDriveshaftNm: Number((sim.vehicle.powertrain as any).deliveredDriveshaftTorque ?? 0),
    tcsActive: Boolean((sim.vehicle as any).driverAids?.tcsActive ?? last.tcsActive ?? false),
    absActive: Boolean((sim.vehicle as any).driverAids?.absActive ?? last.absActive ?? false),
  };
}

function mirrorError(a: number, b: number): number {
  return Math.abs(Math.abs(a) - Math.abs(b)) / Math.max(0.25, (Math.abs(a) + Math.abs(b)) * 0.5);
}

const cases = [
  { speedKmh: 100, centerDeg: 0.9 },
  { speedKmh: 130, centerDeg: 0.9 },
  { speedKmh: 150, centerDeg: 0.9 },
];

for (const c of cases) {
  const left = runStepSteer(c.speedKmh, c.centerDeg, 1);
  const right = runStepSteer(c.speedKmh, c.centerDeg, -1);
  console.log(JSON.stringify({ scenario: 'high-speed-step-steer', ...c, left, right }, null, 2));
  assert(left.spinSamples === 0, `${c.speedKmh}km/h left ${c.centerDeg}deg spun: beta=${left.peakSideslipDeg.toFixed(1)}deg yaw=${left.peakYawDegS.toFixed(1)}deg/s`);
  assert(right.spinSamples === 0, `${c.speedKmh}km/h right ${c.centerDeg}deg spun: beta=${right.peakSideslipDeg.toFixed(1)}deg yaw=${right.peakYawDegS.toFixed(1)}deg/s`);
  assert(left.tailBetaDeg < 8 && right.tailBetaDeg < 8, `sideslip exceeded skidpad 8deg bound at ${c.speedKmh}km/h`);
  assert(mirrorError(left.tailYawDegS, right.tailYawDegS) < 0.10, `yaw left/right mirror drifted at ${c.speedKmh}km/h`);
  assert(mirrorError(left.tailLatG, right.tailLatG) < 0.10, `latG left/right mirror drifted at ${c.speedKmh}km/h`);
  assert(mirrorError(left.yawMomentNm, right.yawMomentNm) < 0.12, `tire yaw moment failed mirror closure at ${c.speedKmh}km/h`);
  const leftOutside = left.tailLoadsN[1] + left.tailLoadsN[3];
  const leftInside = left.tailLoadsN[0] + left.tailLoadsN[2];
  const rightOutside = right.tailLoadsN[0] + right.tailLoadsN[2];
  const rightInside = right.tailLoadsN[1] + right.tailLoadsN[3];
  assert(leftOutside > leftInside, `left turn must load right/outside tires at ${c.speedKmh}km/h`);
  assert(rightOutside > rightInside, `right turn must load left/outside tires at ${c.speedKmh}km/h`);
  assert(mirrorError(leftOutside - leftInside, rightOutside - rightInside) < 0.12, `load-transfer magnitude failed mirror at ${c.speedKmh}km/h`);
  assert(Math.sign(left.finalRearSteerDeg) !== Math.sign(right.finalRearSteerDeg) || Math.abs(left.finalRearSteerDeg) < 1e-9, 'rear steer must mirror left/right');
}
console.log('HighSpeedTurnSpinDiagnostic: PASS');

import assert from 'node:assert/strict';
import type { ControlInputs, VehicleConfig } from '../../types';
import { Simulation } from '../Simulation';
import { ProvingGroundSurfaceProvider } from '../SurfaceProvider';
import { DEFAULT_VEHICLE_CONFIG } from '../vehiclePresets';
import { BMW_M5_2025_OVERRIDES } from '../m5G90';
import {
  digitalSteeringLimitForSpeed,
  updateDigitalSteeringInput,
  type DigitalSteeringContext,
} from '../DigitalSteeringInput';

// Agent 29/35: high-speed sweeper stability, 110-180 km/h.
// Canonical: wheel order [FL, FR, RL, RR], body +X left / +Y up / +Z forward,
// positive steer/yaw means left. Left/right cases must mirror.
// Measures normal simulation only. No grip, damping, steering, aero, brake,
// driveline or assist tuning and no validation-only force/pose/yaw override.
const DT = 1 / 120;
const DEG = 180 / Math.PI;
const SPEEDS_KMH = [110, 140, 180];
const HOLD_SEC = 2.0;
const TAP_HOLD_SEC = 0.15;
const RELEASE_SEC = 1.0;
const FRONT_MEAN_SLIP_LIMIT_DEG = 12.0;
const FRONT_PEAK_SLIP_LIMIT_DEG = 20.0;
const REAR_MEAN_SLIP_LIMIT_DEG = 12.0;
const REAR_PEAK_SLIP_LIMIT_DEG = 20.0;

const config = {
  ...DEFAULT_VEHICLE_CONFIG,
  ...BMW_M5_2025_OVERRIDES,
} as VehicleConfig;

// Document the no-artificial-aid precondition without changing calibration.
assert.equal(
  Number((config as any).driftAssist ?? 0),
  0,
  'sweeper test must run without drift assist'
);
assert.equal(Number((config as any).aeroDownforceFront ?? 0), 0, 'M5 has no invented front downforce');
assert.equal(Number((config as any).aeroDownforceRear ?? 0), 0, 'M5 has no invented rear downforce');
assert.equal(Boolean((config as any).groundEffectUnderbody ?? false), false, 'M5 has no ground-effect aid');

const neutral: ControlInputs = {
  throttle: 0,
  brake: 0,
  steer: 0,
  handbrake: false,
  shiftUp: false,
  shiftDown: false,
};

function makeRollingM5(speedMs: number): Simulation {
  const sim = new Simulation(config, new ProvingGroundSurfaceProvider());
  sim.reset(0, 0, 0);
  sim.vehicle.powertrain.isAutomatic = false;
  (sim.vehicle.powertrain as any).gear = 0;
  for (let i = 0; i < 240; i++) sim.stepExplicit(neutral, 1);
  sim.vehicle.rigidBody.velocity.x = 0;
  sim.vehicle.rigidBody.velocity.z = speedMs;
  for (const wheel of sim.vehicle.wheels) wheel.reset(speedMs);
  for (let i = 0; i < 60; i++) sim.stepExplicit(neutral, 1);
  return sim;
}

function liveContext(sim: Simulation): { speedMs: number; context: DigitalSteeringContext } {
  const localV = sim.vehicle.rigidBody.getLocalVelocity();
  const localW = sim.vehicle.rigidBody.getLocalAngularVelocity();
  const speedMs = Math.hypot(localV.x, localV.z);
  const sideslipRad = speedMs > 0.5 ? Math.atan2(localV.x, Math.max(0.5, Math.abs(localV.z))) : 0;
  return {
    speedMs,
    context: {
      wheelbaseM: config.wheelbase,
      maxSteerAngleRad: config.maxSteerAngle,
      yawRateRadS: localW.y,
      sideslipRad,
      forwardSpeedMs: localV.z,
    },
  };
}

function runHold(speedKmh: number, direction: 1 | -1) {
  const sim = makeRollingM5((speedKmh / 3.6));
  let digital = 0;
  const steps = Math.round(HOLD_SEC / DT);
  let peakDigital = 0;
  let peakFrontSlipDeg = 0;
  let peakRearSlipDeg = 0;
  let peakLatG = 0;
  let peakRollDeg = 0;
  let minimumWheelLoadN = Number.POSITIVE_INFINITY;
  let airborneSamples = 0;
  const late: Array<{ digital: number; frontSlipDeg: number; rearSlipDeg: number; yaw: number; latG: number; speed: number }> = [];
  let finalState: any = null;
  for (let step = 0; step < steps; step++) {
    const live = liveContext(sim);
    digital = updateDigitalSteeringInput(digital, direction, live.speedMs, DT, live.context);
    peakDigital = Math.max(peakDigital, Math.abs(digital));
    finalState = sim.stepExplicit({ ...neutral, steer: digital }, 1);
    const frontSlipDeg = Math.max(Math.abs(finalState.wheels[0].slipAngle), Math.abs(finalState.wheels[1].slipAngle)) * DEG;
    const rearSlipDeg = Math.max(Math.abs(finalState.wheels[2].slipAngle), Math.abs(finalState.wheels[3].slipAngle)) * DEG;
    peakFrontSlipDeg = Math.max(peakFrontSlipDeg, frontSlipDeg);
    peakRearSlipDeg = Math.max(peakRearSlipDeg, rearSlipDeg);
    peakLatG = Math.max(peakLatG, Math.abs(finalState.lateralG));
    peakRollDeg = Math.max(peakRollDeg, Math.abs(finalState.roll) * DEG);
    for (const wheel of finalState.wheels) {
      minimumWheelLoadN = Math.min(minimumWheelLoadN, wheel.forceVectorNorm);
      if (wheel.isAirborne) airborneSamples++;
    }
    if (step >= steps - Math.round(0.75 / DT)) {
      const localV = sim.vehicle.rigidBody.getLocalVelocity();
      const yaw = sim.vehicle.rigidBody.getLocalAngularVelocity().y;
      late.push({
        digital,
        frontSlipDeg,
        rearSlipDeg,
        yaw,
        latG: finalState.lateralG,
        speed: Math.hypot(localV.x, localV.z),
      });
    }
  }
  const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
  const meanFrontSlipDeg = mean(late.map((entry) => entry.frontSlipDeg));
  const meanRearSlipDeg = mean(late.map((entry) => entry.rearSlipDeg));
  const meanYaw = mean(late.map((entry) => Math.abs(entry.yaw)));
  const meanLatG = mean(late.map((entry) => Math.abs(entry.latG)));
  const meanSpeed = mean(late.map((entry) => entry.speed));
  const meanDigital = mean(late.map((entry) => Math.abs(entry.digital)));
  const radiusM = meanYaw > 0.02 ? meanSpeed / meanYaw : Number.POSITIVE_INFINITY;
  const normalLimit = digitalSteeringLimitForSpeed(speedKmh / 3.6, { wheelbaseM: config.wheelbase, maxSteerAngleRad: config.maxSteerAngle });
  return {
    speedKmh,
    direction,
    peakDigital,
    normalLimit,
    meanDigital,
    peakFrontSlipDeg,
    meanFrontSlipDeg,
    peakRearSlipDeg,
    meanRearSlipDeg,
    peakLatG,
    meanLatG,
    meanYawDegS: meanYaw * DEG,
    radiusM,
    peakRollDeg,
    minimumWheelLoadN,
    airborneSamples,
    finalX: finalState.x,
    finalZ: finalState.z,
    finalSpeedKmh: finalState.speedKmh,
  };
}

function runTap(speedKmh: number, direction: 1 | -1) {
  const sim = makeRollingM5(speedKmh / 3.6);
  let digital = 0;
  const tapSteps = Math.round(TAP_HOLD_SEC / DT);
  const releaseSteps = Math.round(RELEASE_SEC / DT);
  let peakYaw = 0;
  let peakFrontSlipDeg = 0;
  for (let step = 0; step < tapSteps; step++) {
    const live = liveContext(sim);
    digital = updateDigitalSteeringInput(digital, direction, live.speedMs, DT, live.context);
    const state = sim.stepExplicit({ ...neutral, steer: digital }, 1);
    peakYaw = Math.max(peakYaw, Math.abs(state.yawRate));
    peakFrontSlipDeg = Math.max(peakFrontSlipDeg, Math.max(Math.abs(state.wheels[0].slipAngle), Math.abs(state.wheels[1].slipAngle)) * DEG);
  }
  for (let step = 0; step < releaseSteps; step++) {
    const live = liveContext(sim);
    digital = updateDigitalSteeringInput(digital, 0, live.speedMs, DT, live.context);
    sim.stepExplicit({ ...neutral, steer: digital }, 1);
  }
  const end = sim.vehicle.getState();
  return {
    speedKmh,
    direction,
    releasedDigital: digital,
    peakYawDegS: peakYaw * DEG,
    residualYawDegS: Math.abs(end.yawRate) * DEG,
    peakFrontSlipDeg,
  };
}

const holds: any[] = [];
for (const speedKmh of SPEEDS_KMH) {
  const left = runHold(speedKmh, 1);
  const right = runHold(speedKmh, -1);
  holds.push({ speedKmh, left, right });
  // Curvature authority without parking-lock: small-angle hold must produce useful yaw.
  assert(left.peakDigital < 0.15 && right.peakDigital < 0.15, `${speedKmh} km/h sweeper hold used too much rack`);
  assert(left.peakDigital > 0.005 && right.peakDigital > 0.005, `${speedKmh} km/h sweeper hold produced no steering authority`);
  assert(left.meanYawDegS > 1.0 && right.meanYawDegS > 1.0, `${speedKmh} km/h sweeper hold produced no useful yaw`);
  assert(Number.isFinite(left.radiusM) && left.radiusM > 40 && left.radiusM < 900, `${speedKmh} km/h left radius implausible: ${left.radiusM}`);
  assert(Number.isFinite(right.radiusM) && right.radiusM > 40 && right.radiusM < 900, `${speedKmh} km/h right radius implausible: ${right.radiusM}`);
  // No front saturation: do not fix failures with extra grip.
  assert(left.meanFrontSlipDeg < FRONT_MEAN_SLIP_LIMIT_DEG, `${speedKmh} km/h LEFT front saturation: ${left.meanFrontSlipDeg.toFixed(2)} deg`);
  assert(right.meanFrontSlipDeg < FRONT_MEAN_SLIP_LIMIT_DEG, `${speedKmh} km/h RIGHT front saturation: ${right.meanFrontSlipDeg.toFixed(2)} deg`);
  assert(left.peakFrontSlipDeg < FRONT_PEAK_SLIP_LIMIT_DEG && right.peakFrontSlipDeg < FRONT_PEAK_SLIP_LIMIT_DEG, `${speedKmh} km/h front slip peak saturated`);
  assert(left.meanRearSlipDeg < REAR_MEAN_SLIP_LIMIT_DEG, `${speedKmh} km/h LEFT rear unstable: ${left.meanRearSlipDeg.toFixed(2)} deg`);
  assert(right.meanRearSlipDeg < REAR_MEAN_SLIP_LIMIT_DEG, `${speedKmh} km/h RIGHT rear unstable: ${right.meanRearSlipDeg.toFixed(2)} deg`);
  assert(left.peakRearSlipDeg < REAR_PEAK_SLIP_LIMIT_DEG && right.peakRearSlipDeg < REAR_PEAK_SLIP_LIMIT_DEG, `${speedKmh} km/h rear slip peak excessive`);
  assert(left.meanLatG < 1.35 && right.meanLatG < 1.35, `${speedKmh} km/h lateral G implausible`);
  assert(left.peakLatG < 1.35 && right.peakLatG < 1.35, `${speedKmh} km/h peak lateral G implausible`);
  assert(left.peakRollDeg < 5.0 && right.peakRollDeg < 5.0, `${speedKmh} km/h roll excessive`);
  assert(left.airborneSamples === 0 && right.airborneSamples === 0, `${speedKmh} km/h sweeper lifted a wheel`);
  assert(left.minimumWheelLoadN > 500 && right.minimumWheelLoadN > 500, `${speedKmh} km/h inside unloaded implausibly`);
  // Exact mirror: left (+steer/+yaw/+X) vs right (-steer/-yaw/-X).
  const yawTolerance = Math.max(0.5, 0.05 * Math.max(left.meanYawDegS, right.meanYawDegS));
  assert(Math.abs(left.meanYawDegS - right.meanYawDegS) <= yawTolerance, `${speedKmh} km/h yaw failed mirror`);
  assert(Math.abs(left.finalX + right.finalX) <= Math.max(1.0, 0.08 * Math.max(Math.abs(left.finalX), Math.abs(right.finalX))), `${speedKmh} km/h trajectory failed mirror`);
  assert(Math.abs(left.meanFrontSlipDeg - right.meanFrontSlipDeg) <= Math.max(0.5, 0.08 * Math.max(left.meanFrontSlipDeg, right.meanFrontSlipDeg)), `${speedKmh} km/h front slip failed mirror`);
  assert(Math.abs(left.meanRearSlipDeg - right.meanRearSlipDeg) <= Math.max(0.5, 0.08 * Math.max(left.meanRearSlipDeg, right.meanRearSlipDeg)), `${speedKmh} km/h rear slip failed mirror`);
}

for (const speedKmh of SPEEDS_KMH) {
  for (const direction of [1, -1] as const) {
    const tap = runTap(speedKmh, direction);
    assert(Math.abs(tap.releasedDigital) < 1e-12, `${speedKmh} km/h tap did not release to center`);
    assert(tap.peakYawDegS > 0.3, `${speedKmh} km/h tap produced no transient yaw`);
    assert(tap.peakFrontSlipDeg < FRONT_PEAK_SLIP_LIMIT_DEG, `${speedKmh} km/h tap saturated front tires`);
    assert(tap.residualYawDegS < Math.max(2.0, tap.peakYawDegS * 0.6), `${speedKmh} km/h tap yaw did not unwind`);
  }
  const leftTap = runTap(speedKmh, 1);
  const rightTap = runTap(speedKmh, -1);
  assert(Math.abs(leftTap.peakYawDegS - rightTap.peakYawDegS) <= Math.max(0.5, 0.08 * Math.max(leftTap.peakYawDegS, rightTap.peakYawDegS)), `${speedKmh} km/h tap failed mirror`);
}

console.log(JSON.stringify({
  scenario: 'M5 high-speed sweeper stability 110-180 km/h, small digital holds/taps',
  speedsKmh: SPEEDS_KMH,
  holdSec: HOLD_SEC,
  tapSec: TAP_HOLD_SEC,
  holds: holds.map((entry) => ({
    speedKmh: entry.speedKmh,
    left: { peakDigital: entry.left.peakDigital, yawDegS: entry.left.meanYawDegS, frontSlipDeg: entry.left.meanFrontSlipDeg, rearSlipDeg: entry.left.meanRearSlipDeg, latG: entry.left.meanLatG, radiusM: entry.left.radiusM, x: entry.left.finalX },
    right: { peakDigital: entry.right.peakDigital, yawDegS: entry.right.meanYawDegS, frontSlipDeg: entry.right.meanFrontSlipDeg, rearSlipDeg: entry.right.meanRearSlipDeg, latG: entry.right.meanLatG, radiusM: entry.right.radiusM, x: entry.right.finalX },
  })),
  status: 'passed',
}, null, 2));
console.log('HighSpeedSweeperStabilityTests: PASS');

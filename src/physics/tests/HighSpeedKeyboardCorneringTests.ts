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

// Deterministic full-vehicle keyboard cornering gate.
// Canonical: [FL,FR,RL,RR], +X left/+Y up/+Z forward, +steer/+yaw = left.
// Normal digital steering must stay in the useful tire region; emergency
// countersteer authority is covered separately by M5OversteerRecoveryDiagnostic.
const DT = 1 / 120;
const DEG = 180 / Math.PI;
const SPEEDS_KMH = [40, 70, 100, 120];
const HOLD_SEC = 2.0;
const TAP_HOLD_SEC = 0.15;
const RELEASE_SEC = 1.0;
const USEFUL_SLIP_MEAN_DEG = 12.0;
const USEFUL_SLIP_PEAK_DEG = 20.0;

const config = {
  ...DEFAULT_VEHICLE_CONFIG,
  ...BMW_M5_2025_OVERRIDES,
} as VehicleConfig;

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

function steeringContext(sim: Simulation): { speedMs: number; context: DigitalSteeringContext } {
  const localV = sim.vehicle.rigidBody.getLocalVelocity();
  const localW = sim.vehicle.rigidBody.getLocalAngularVelocity();
  const speedMs = Math.hypot(localV.x, localV.z);
  const sideslipRad =
    speedMs > 0.5 ? Math.atan2(localV.x, Math.max(0.5, Math.abs(localV.z))) : 0;
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

function wheelUtil(wheel: any): number {
  const candidate =
    wheel.gripUtilization ??
    wheel.combinedSlipUtilization ??
    wheel.skidIntensity ??
    0;
  return Number.isFinite(candidate) ? candidate : 0;
}

function runDigitalHold(speedKmh: number, direction: 1 | -1) {
  const sim = makeRollingM5(speedKmh / 3.6);
  let digital = 0;
  const steps = Math.round(HOLD_SEC / DT);
  let peakDigital = 0;
  let peakFrontSlipDeg = 0;
  let peakLatG = 0;
  let minimumNormalLimit = 1;
  const late: any[] = [];
  let finalState: any = null;

  for (let step = 0; step < steps; step++) {
    const live = steeringContext(sim);
    const normalLimit = digitalSteeringLimitForSpeed(live.speedMs, live.context);
    minimumNormalLimit = Math.min(minimumNormalLimit, normalLimit);
    digital = updateDigitalSteeringInput(
      digital,
      direction,
      live.speedMs,
      DT,
      live.context
    );
    peakDigital = Math.max(peakDigital, Math.abs(digital));

    finalState = sim.stepExplicit({ ...neutral, steer: digital }, 1);
    const frontSlipDeg =
      Math.max(
        Math.abs(finalState.wheels[0].slipAngle),
        Math.abs(finalState.wheels[1].slipAngle)
      ) * DEG;
    peakFrontSlipDeg = Math.max(peakFrontSlipDeg, frontSlipDeg);
    peakLatG = Math.max(peakLatG, Math.abs(finalState.lateralG));

    if (step >= steps - Math.round(0.75 / DT)) {
      const localV = sim.vehicle.rigidBody.getLocalVelocity();
      const yaw = sim.vehicle.rigidBody.getLocalAngularVelocity().y;
      late.push({
        digital,
        centerDeg: finalState.actualSteerAngle * DEG,
        frontSlipDeg,
        rearSlipDeg:
          Math.max(
            Math.abs(finalState.wheels[2].slipAngle),
            Math.abs(finalState.wheels[3].slipAngle)
          ) * DEG,
        frontFyN:
          finalState.wheels[0].forceVectorLat +
          finalState.wheels[1].forceVectorLat,
        frontUtil: Math.max(
          wheelUtil(finalState.wheels[0]),
          wheelUtil(finalState.wheels[1])
        ),
        yawRadS: yaw,
        latG: finalState.lateralG,
        speedMs: Math.hypot(localV.x, localV.z),
        x: finalState.x,
        z: finalState.z,
        fz: finalState.wheels.map((wheel: any) => wheel.forceVectorNorm),
      });
    }
  }

  const mean = (values: number[]) =>
    values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
  const meanDigital = mean(late.map((entry) => Math.abs(entry.digital)));
  const meanCenterDeg = mean(late.map((entry) => Math.abs(entry.centerDeg)));
  const meanFrontSlipDeg = mean(late.map((entry) => entry.frontSlipDeg));
  const meanYaw = mean(late.map((entry) => Math.abs(entry.yawRadS)));
  const meanLatG = mean(late.map((entry) => Math.abs(entry.latG)));
  const meanSpeed = mean(late.map((entry) => entry.speedMs));
  const radiusM = meanYaw > 0.02 ? meanSpeed / meanYaw : Number.POSITIVE_INFINITY;

  return {
    speedKmh,
    direction,
    peakDigital,
    minimumNormalLimit,
    peakFrontSlipDeg,
    peakLatG,
    lateMeanDigital: meanDigital,
    lateMeanCenterDeg: meanCenterDeg,
    lateMeanFrontSlipDeg: meanFrontSlipDeg,
    lateMeanYawDegS: meanYaw * DEG,
    lateMeanLatG: meanLatG,
    lateMeanRadiusM: radiusM,
    finalX: finalState.x,
    finalZ: finalState.z,
    finalSpeedKmh: finalState.speedKmh,
    late,
  };
}

function runTapRelease(speedKmh: number, direction: 1 | -1) {
  const sim = makeRollingM5(speedKmh / 3.6);
  let digital = 0;
  const tapSteps = Math.round(TAP_HOLD_SEC / DT);
  const releaseSteps = Math.round(RELEASE_SEC / DT);
  let peakYaw = 0;

  for (let step = 0; step < tapSteps; step++) {
    const live = steeringContext(sim);
    digital = updateDigitalSteeringInput(digital, direction, live.speedMs, DT, live.context);
    const state = sim.stepExplicit({ ...neutral, steer: digital }, 1);
    peakYaw = Math.max(peakYaw, Math.abs(state.yawRate));
  }

  for (let step = 0; step < releaseSteps; step++) {
    const live = steeringContext(sim);
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
  };
}

function checkDirectRackAuthority() {
  // Mechanical/analog authority remains full at road speed. Digital shaping
  // changes only the binary driver's request, never the rack stops.
  for (const direction of [1, -1] as const) {
    const sim = makeRollingM5(100 / 3.6);
    const aids = sim.vehicle.driverAids;
    aids.reset();
    let center = 0;
    for (let i = 0; i < 180; i++) {
      center = aids.updateSteering(direction, 100 / 3.6, DT).centerAngle;
    }
    const maxDeg = config.maxSteerAngle * DEG;
    assert(
      Math.abs(Math.abs(center) * DEG - maxDeg) < 0.5,
      `direct rack authority lost: dir=${direction} center=${(center * DEG).toFixed(2)}deg max=${maxDeg.toFixed(2)}deg`
    );
  }
}

const holds: any[] = [];
for (const speedKmh of SPEEDS_KMH) {
  const left = runDigitalHold(speedKmh, 1);
  const right = runDigitalHold(speedKmh, -1);
  holds.push({ speedKmh, left, right });

  // The core regression: road-speed binary steering must NOT silently wind to
  // parking-lot lock. At the lowest 40 km/h case the car can scrub speed enough
  // for the dynamic envelope to grow, so retain margin while still excluding 1.0.
  assert(
    left.peakDigital < 0.90 && right.peakDigital < 0.90,
    `${speedKmh}km/h normal digital hold approached full rack: L=${left.peakDigital.toFixed(3)} R=${right.peakDigital.toFixed(3)}`
  );

  const maxDeg = config.maxSteerAngle * DEG;
  assert(
    left.lateMeanCenterDeg <= maxDeg + 0.5 &&
      right.lateMeanCenterDeg <= maxDeg + 0.5,
    `${speedKmh}km/h center exceeded mechanical rack`
  );

  const yawTolerance =
    Math.max(0.02, 0.05 * Math.max(left.lateMeanYawDegS, right.lateMeanYawDegS)) + 0.5;
  assert(
    Math.abs(left.lateMeanYawDegS - right.lateMeanYawDegS) <= yawTolerance,
    `${speedKmh}km/h yaw failed mirror: L=${left.lateMeanYawDegS.toFixed(2)} R=${right.lateMeanYawDegS.toFixed(2)}`
  );

  assert(
    Math.abs(left.finalX + right.finalX) <=
      Math.max(1.0, 0.08 * Math.max(Math.abs(left.finalX), Math.abs(right.finalX))),
    `${speedKmh}km/h trajectory failed mirror: Lx=${left.finalX.toFixed(2)} Rx=${right.finalX.toFixed(2)}`
  );

  assert(
    Math.abs(left.lateMeanFrontSlipDeg - right.lateMeanFrontSlipDeg) <=
      Math.max(0.5, 0.08 * Math.max(left.lateMeanFrontSlipDeg, right.lateMeanFrontSlipDeg)),
    `${speedKmh}km/h front slip failed mirror`
  );

  const minYaw = speedKmh <= 45 ? 3.0 : speedKmh <= 75 ? 2.0 : 1.5;
  assert(
    left.lateMeanYawDegS > minYaw && right.lateMeanYawDegS > minYaw,
    `${speedKmh}km/h produced no useful yaw: L=${left.lateMeanYawDegS.toFixed(2)} R=${right.lateMeanYawDegS.toFixed(2)}`
  );
  assert(
    Number.isFinite(left.lateMeanRadiusM) &&
      left.lateMeanRadiusM > 5 &&
      left.lateMeanRadiusM < 800,
    `${speedKmh}km/h radius implausible: ${left.lateMeanRadiusM}`
  );
  assert(
    left.lateMeanLatG < 1.35 && right.lateMeanLatG < 1.35,
    `${speedKmh}km/h lateral G implausible`
  );

  // Tire-over-command gate. Do not "fix" failures here with extra grip.
  assert(
    left.lateMeanFrontSlipDeg < USEFUL_SLIP_MEAN_DEG,
    `${speedKmh}km/h LEFT over-command: front slip ${left.lateMeanFrontSlipDeg.toFixed(1)}deg center ${left.lateMeanCenterDeg.toFixed(1)}deg yaw ${left.lateMeanYawDegS.toFixed(1)}deg/s latG ${left.lateMeanLatG.toFixed(2)}g radius ${left.lateMeanRadiusM.toFixed(1)}m`
  );
  assert(
    right.lateMeanFrontSlipDeg < USEFUL_SLIP_MEAN_DEG,
    `${speedKmh}km/h RIGHT over-command: front slip ${right.lateMeanFrontSlipDeg.toFixed(1)}deg`
  );
  assert(
    left.peakFrontSlipDeg < USEFUL_SLIP_PEAK_DEG &&
      right.peakFrontSlipDeg < USEFUL_SLIP_PEAK_DEG,
    `${speedKmh}km/h front slip peak saturated`
  );
}

for (const speedKmh of SPEEDS_KMH) {
  for (const direction of [1, -1] as const) {
    const tap = runTapRelease(speedKmh, direction);
    assert(
      Math.abs(tap.releasedDigital) < 1e-12,
      `${speedKmh}km/h tap did not release to center`
    );
    assert(
      tap.residualYawDegS < Math.max(2.0, tap.peakYawDegS * 0.6),
      `${speedKmh}km/h tap yaw did not unwind: peak=${tap.peakYawDegS.toFixed(1)} residual=${tap.residualYawDegS.toFixed(1)}`
    );
  }
}

checkDirectRackAuthority();

console.log(JSON.stringify({
  scenario: 'M5 high-speed keyboard cornering gate',
  speedsKmh: SPEEDS_KMH,
  holdSec: HOLD_SEC,
  tapSec: TAP_HOLD_SEC,
  releaseSec: RELEASE_SEC,
  usefulSlipMeanDeg: USEFUL_SLIP_MEAN_DEG,
  usefulSlipPeakDeg: USEFUL_SLIP_PEAK_DEG,
  holds: holds.map((entry) => ({
    speedKmh: entry.speedKmh,
    left: {
      peakDigital: entry.left.peakDigital,
      centerDeg: entry.left.lateMeanCenterDeg,
      frontSlipDeg: entry.left.lateMeanFrontSlipDeg,
      peakSlipDeg: entry.left.peakFrontSlipDeg,
      yawDegS: entry.left.lateMeanYawDegS,
      latG: entry.left.lateMeanLatG,
      radiusM: entry.left.lateMeanRadiusM,
      x: entry.left.finalX,
    },
    right: {
      peakDigital: entry.right.peakDigital,
      centerDeg: entry.right.lateMeanCenterDeg,
      frontSlipDeg: entry.right.lateMeanFrontSlipDeg,
      peakSlipDeg: entry.right.peakFrontSlipDeg,
      yawDegS: entry.right.lateMeanYawDegS,
      latG: entry.right.lateMeanLatG,
      radiusM: entry.right.lateMeanRadiusM,
      x: entry.right.finalX,
    },
  })),
  status: 'passed',
}, null, 2));

console.log('HighSpeedKeyboardCorneringTests: PASS');

import assert from 'node:assert/strict';
import type { ControlInputs, VehicleConfig } from '../../types';
import { mobileWheelRotationToSteer } from '../../components/mobileControls';
import { Simulation } from '../Simulation';
import { ProvingGroundSurfaceProvider } from '../SurfaceProvider';
import { DEFAULT_VEHICLE_CONFIG } from '../vehiclePresets';
import { BMW_M5_2025_OVERRIDES } from '../m5G90';

const DT = 1 / 120;
const DEG = 180 / Math.PI;
const HOLD_SEC = 1.6;
const TAIL_SEC = 0.5;
const SPEEDS_KMH = [30, 50, 70, 80, 100];
const HAND_ANGLES_DEG = [30, 60, 90, 135, 180];

const neutral: ControlInputs = {
  throttle: 0,
  brake: 0,
  steer: 0,
  handbrake: false,
  shiftUp: false,
  shiftDown: false,
};

function makeConfig(rearSteerMaxDeg: number): VehicleConfig {
  return {
    ...DEFAULT_VEHICLE_CONFIG,
    ...BMW_M5_2025_OVERRIDES,
    rearSteerMaxDeg,
  } as VehicleConfig;
}

function makeRollingM5(speedKmh: number, rearSteerMaxDeg: number) {
  const config = makeConfig(rearSteerMaxDeg);
  const speedMs = speedKmh / 3.6;
  const sim = new Simulation(config, new ProvingGroundSurfaceProvider());
  sim.reset(0, 0, 0);
  sim.vehicle.powertrain.isAutomatic = false;
  sim.vehicle.powertrain.gear = 0;
  sim.vehicle.rigidBody.velocity.z = speedMs;
  for (const wheel of sim.vehicle.wheels) {
    wheel.angularVelocity = speedMs / config.wheelRadius;
  }
  for (let i = 0; i < 60; i++) sim.stepExplicit(neutral, 1);
  return sim;
}

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
}

function runHandWheelCase(
  speedKmh: number,
  handAngleDeg: number,
  direction: 1 | -1,
  rearSteerMaxDeg: number
) {
  const sim = makeRollingM5(speedKmh, rearSteerMaxDeg);
  const steerInput = mobileWheelRotationToSteer(-direction * handAngleDeg);
  const totalSteps = Math.round(HOLD_SEC / DT);
  const tailStart = totalSteps - Math.round(TAIL_SEC / DT);
  const tail: Array<{
    frontSlipDeg: number;
    rearSlipDeg: number;
    frontSteerDeg: number;
    rearSteerDeg: number;
    yawDegS: number;
    latG: number;
    speedKmh: number;
  }> = [];
  let peakFrontSlipDeg = 0;
  let peakLatG = 0;
  let airborneSamples = 0;

  for (let step = 0; step < totalSteps; step++) {
    const state = sim.stepExplicit({ ...neutral, steer: steerInput }, 1);
    const frontSlipDeg =
      Math.max(
        Math.abs(state.wheels[0].slipAngle),
        Math.abs(state.wheels[1].slipAngle)
      ) * DEG;
    const rearSlipDeg =
      Math.max(
        Math.abs(state.wheels[2].slipAngle),
        Math.abs(state.wheels[3].slipAngle)
      ) * DEG;
    const frontSteerDeg =
      Math.abs((state.wheels[0].steerAngle + state.wheels[1].steerAngle) * 0.5) * DEG;
    const rearSteerDeg =
      ((state.wheels[2].steerAngle + state.wheels[3].steerAngle) * 0.5) * DEG;

    peakFrontSlipDeg = Math.max(peakFrontSlipDeg, frontSlipDeg);
    peakLatG = Math.max(peakLatG, Math.abs(state.lateralG));
    airborneSamples += state.wheels.filter((wheel) => wheel.isAirborne).length;

    if (step >= tailStart) {
      tail.push({
        frontSlipDeg,
        rearSlipDeg,
        frontSteerDeg,
        rearSteerDeg,
        yawDegS: state.yawRate * DEG,
        latG: state.lateralG,
        speedKmh: state.speedKmh,
      });
    }
  }

  const result = {
    speedKmh,
    handAngleDeg,
    direction,
    rearSteerMaxDeg,
    steerInput,
    tailFrontSlipDeg: mean(tail.map((sample) => sample.frontSlipDeg)),
    tailRearSlipDeg: mean(tail.map((sample) => sample.rearSlipDeg)),
    tailFrontSteerDeg: mean(tail.map((sample) => sample.frontSteerDeg)),
    tailRearSteerDeg: mean(tail.map((sample) => sample.rearSteerDeg)),
    tailYawDegS: mean(tail.map((sample) => sample.yawDegS)),
    tailLatG: mean(tail.map((sample) => sample.latG)),
    tailSpeedKmh: mean(tail.map((sample) => sample.speedKmh)),
    peakFrontSlipDeg,
    peakLatG,
    airborneSamples,
  };

  for (const [key, value] of Object.entries(result)) {
    if (typeof value === 'number') {
      assert(Number.isFinite(value), `${key} became non-finite at ${speedKmh}km/h / ${handAngleDeg}deg`);
    }
  }
  assert(airborneSamples === 0, `flat-road steering went airborne at ${speedKmh}km/h / ${handAngleDeg}deg`);
  assert(Math.abs(steerInput) < 1, 'characterization angles must stay below full rack');

  return result;
}

const defaultRearSteerDeg = Number((BMW_M5_2025_OVERRIDES as any).rearSteerMaxDeg ?? 0);
const sweeps = SPEEDS_KMH.flatMap((speedKmh) =>
  HAND_ANGLES_DEG.map((handAngleDeg) => {
    const active = runHandWheelCase(speedKmh, handAngleDeg, 1, defaultRearSteerDeg);
    const disabled = runHandWheelCase(speedKmh, handAngleDeg, 1, 0);
    return {
      speedKmh,
      handAngleDeg,
      steerInput: active.steerInput,
      active,
      rearSteerDisabled: disabled,
      rearSteerDelta: {
        frontSlipDeg: active.tailFrontSlipDeg - disabled.tailFrontSlipDeg,
        yawDegS: active.tailYawDegS - disabled.tailYawDegS,
        latG: active.tailLatG - disabled.tailLatG,
      },
    };
  })
);

const mirrors = SPEEDS_KMH.map((speedKmh) => {
  const left = runHandWheelCase(speedKmh, 60, 1, defaultRearSteerDeg);
  const right = runHandWheelCase(speedKmh, 60, -1, defaultRearSteerDeg);
  const slipAsym =
    Math.abs(left.tailFrontSlipDeg - right.tailFrontSlipDeg) /
    Math.max(0.25, (left.tailFrontSlipDeg + right.tailFrontSlipDeg) * 0.5);
  const yawAsym =
    Math.abs(Math.abs(left.tailYawDegS) - Math.abs(right.tailYawDegS)) /
    Math.max(0.25, (Math.abs(left.tailYawDegS) + Math.abs(right.tailYawDegS)) * 0.5);
  assert(slipAsym < 0.08, `${speedKmh}km/h 60deg hand input front-slip mirror failed: ${(slipAsym * 100).toFixed(1)}%`);
  assert(yawAsym < 0.08, `${speedKmh}km/h 60deg hand input yaw mirror failed: ${(yawAsym * 100).toFixed(1)}%`);

  // Player-facing regression: an ordinary 60-degree hand-wheel input must stay
  // inside the M5 tire's useful pre/post-peak boundary across the core road-speed
  // range. Full rack is still reachable with more steering travel.
  assert(
    left.peakFrontSlipDeg < 8.0 && right.peakFrontSlipDeg < 8.0,
    `${speedKmh}km/h 60deg hand input over-commanded front tires: L=${left.peakFrontSlipDeg.toFixed(2)}deg R=${right.peakFrontSlipDeg.toFixed(2)}deg`
  );

  return { speedKmh, left, right, slipAsym, yawAsym };
});

console.log(JSON.stringify({
  scenario: 'M5 mobile hand-wheel tire-feel sweep',
  steeringRotationDeg: 900,
  rearSteerMaxDeg: defaultRearSteerDeg,
  speedsKmh: SPEEDS_KMH,
  handAnglesDeg: HAND_ANGLES_DEG,
  sweeps,
  mirrors,
  status: 'passed',
}, null, 2));

console.log('TireFeelSteeringSweepTests: PASS');

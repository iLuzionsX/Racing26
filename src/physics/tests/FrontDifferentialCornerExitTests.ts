import assert from 'node:assert/strict';
import type { DifferentialType } from '../../types';
import type { ControlInputs, VehicleConfig } from '../../types';
import { mobileWheelRotationToSteer } from '../../components/mobileControls';
import { PhysicsMath } from '../math/PhysicsMath';
import { Simulation } from '../Simulation';
import { ProvingGroundSurfaceProvider } from '../SurfaceProvider';
import { DEFAULT_VEHICLE_CONFIG } from '../vehiclePresets';
import { BMW_M5_2025_OVERRIDES } from '../m5G90';

const DT = 1 / 120;
const DEG = 180 / Math.PI;
const START_SPEED_KMH = 70;
const START_SPEED_MS = START_SPEED_KMH / 3.6;
const HAND_ANGLE_DEG = 45;
const STEER = Math.abs(mobileWheelRotationToSteer(-HAND_ANGLE_DEG));
const STEER_BUILD_SEC = 0.8;
const POWER_SEC = 1.2;
const TAIL_SEC = 0.4;

const neutral: ControlInputs = {
  throttle: 0,
  brake: 0,
  steer: 0,
  handbrake: false,
  shiftUp: false,
  shiftDown: false,
};

const config = {
  ...DEFAULT_VEHICLE_CONFIG,
  ...BMW_M5_2025_OVERRIDES,
  tcsMode: 'OFF',
  absMode: 'OFF',
} as VehicleConfig;

function makeRollingM5(frontType: DifferentialType) {
  const sim = new Simulation(config, new ProvingGroundSurfaceProvider());
  sim.reset(0, 0, 0);

  for (let i = 0; i < 240; i++) sim.stepExplicit(neutral, 1);

  sim.vehicle.rigidBody.velocity = PhysicsMath.vec3(0, 0, START_SPEED_MS);
  for (const wheel of sim.vehicle.wheels) wheel.reset(START_SPEED_MS);

  sim.vehicle.powertrain.isAutomatic = false;
  sim.vehicle.powertrain.gear = 3;
  const gearRatio = Math.abs(config.forwardGearRatios[2] ?? 2.14);
  const totalRatio = gearRatio * Math.abs(config.finalDriveRatio);
  const wheelOmega = START_SPEED_MS / config.wheelRadius;
  const matchedRpm = wheelOmega * totalRatio * 60 / (2 * Math.PI);
  sim.vehicle.powertrain.engineRpm = matchedRpm;
  sim.vehicle.powertrain.flywheelRpm = matchedRpm;

  // Production behavior remains the shared TORQUE_VECTOR default. The optional
  // per-axle field exists only to let this normal differential path isolate the
  // front axle while keeping the rear type and center coupling unchanged.
  sim.vehicle.differential.config.frontType = frontType;
  sim.vehicle.differential.config.rearType = config.differentialType;

  return sim;
}

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
}

function runCase(frontType: DifferentialType, direction: 1 | -1) {
  const sim = makeRollingM5(frontType);
  const signedSteer = STEER * direction;

  // Establish the same neutral-throttle cornering state first.
  const steerBuildSteps = Math.round(STEER_BUILD_SEC / DT);
  for (let step = 0; step < steerBuildSteps; step++) {
    const ramp = Math.min(1, (step + 1) / Math.max(1, Math.round(0.20 / DT)));
    sim.stepExplicit({ ...neutral, steer: signedSteer * ramp }, 1);
  }

  const powerSteps = Math.round(POWER_SEC / DT);
  const tailStart = powerSteps - Math.round(TAIL_SEC / DT);

  const samples: Array<{
    speedKmh: number;
    yawDegS: number;
    latG: number;
    frontSlipDeg: number;
    rearSlipDeg: number;
    insideFrontKappa: number;
    outsideFrontKappa: number;
    insideFrontFxN: number;
    outsideFrontFxN: number;
    insideFrontFyN: number;
    outsideFrontFyN: number;
    insideFrontFzN: number;
    outsideFrontFzN: number;
    frontOmegaDeltaRadS: number;
  }> = [];

  let peakFrontSlipDeg = 0;
  let peakInsideFrontKappa = 0;
  let peakOutsideFrontKappa = 0;
  let peakLatG = 0;

  for (let step = 0; step < powerSteps; step++) {
    const t = step / Math.max(1, powerSteps - 1);
    const throttle = 0.18 + 0.47 * Math.min(1, t / 0.65);
    const state = sim.stepExplicit(
      { ...neutral, steer: signedSteer, throttle },
      1
    );

    const insideIndex = direction > 0 ? 0 : 1;
    const outsideIndex = direction > 0 ? 1 : 0;
    const inside = state.wheels[insideIndex];
    const outside = state.wheels[outsideIndex];
    const frontSlipDeg = Math.max(
      Math.abs(state.wheels[0].slipAngle),
      Math.abs(state.wheels[1].slipAngle)
    ) * DEG;
    const rearSlipDeg = Math.max(
      Math.abs(state.wheels[2].slipAngle),
      Math.abs(state.wheels[3].slipAngle)
    ) * DEG;

    peakFrontSlipDeg = Math.max(peakFrontSlipDeg, frontSlipDeg);
    peakInsideFrontKappa = Math.max(peakInsideFrontKappa, Math.abs(inside.slipRatio));
    peakOutsideFrontKappa = Math.max(peakOutsideFrontKappa, Math.abs(outside.slipRatio));
    peakLatG = Math.max(peakLatG, Math.abs(state.lateralG));

    if (step >= tailStart) {
      samples.push({
        speedKmh: state.speedKmh,
        yawDegS: state.yawRate * DEG,
        latG: Math.abs(state.lateralG),
        frontSlipDeg,
        rearSlipDeg,
        insideFrontKappa: Math.abs(inside.slipRatio),
        outsideFrontKappa: Math.abs(outside.slipRatio),
        insideFrontFxN: inside.forceVectorLong,
        outsideFrontFxN: outside.forceVectorLong,
        insideFrontFyN: inside.forceVectorLat,
        outsideFrontFyN: outside.forceVectorLat,
        insideFrontFzN: inside.forceVectorNorm,
        outsideFrontFzN: outside.forceVectorNorm,
        frontOmegaDeltaRadS:
          sim.vehicle.wheels[insideIndex].angularVelocity -
          sim.vehicle.wheels[outsideIndex].angularVelocity,
      });
    }
  }

  const result = {
    frontType,
    direction,
    handAngleDeg: HAND_ANGLE_DEG,
    steerInput: signedSteer,
    peakFrontSlipDeg,
    peakInsideFrontKappa,
    peakOutsideFrontKappa,
    peakLatG,
    tail: {
      speedKmh: mean(samples.map((s) => s.speedKmh)),
      yawDegS: mean(samples.map((s) => s.yawDegS)),
      latG: mean(samples.map((s) => s.latG)),
      frontSlipDeg: mean(samples.map((s) => s.frontSlipDeg)),
      rearSlipDeg: mean(samples.map((s) => s.rearSlipDeg)),
      insideFrontKappa: mean(samples.map((s) => s.insideFrontKappa)),
      outsideFrontKappa: mean(samples.map((s) => s.outsideFrontKappa)),
      insideFrontFxN: mean(samples.map((s) => s.insideFrontFxN)),
      outsideFrontFxN: mean(samples.map((s) => s.outsideFrontFxN)),
      insideFrontFyN: mean(samples.map((s) => s.insideFrontFyN)),
      outsideFrontFyN: mean(samples.map((s) => s.outsideFrontFyN)),
      insideFrontFzN: mean(samples.map((s) => s.insideFrontFzN)),
      outsideFrontFzN: mean(samples.map((s) => s.outsideFrontFzN)),
      frontOmegaDeltaRadS: mean(samples.map((s) => s.frontOmegaDeltaRadS)),
    },
  };

  for (const [key, value] of Object.entries(result.tail)) {
    assert(Number.isFinite(value), `${frontType} ${direction} tail ${key} non-finite`);
  }
  assert(result.tail.outsideFrontFzN > result.tail.insideFrontFzN,
    `${frontType} ${direction}: outside front must carry more load in the corner`);
  assert(peakFrontSlipDeg < 25,
    `${frontType} ${direction}: diagnostic became an uncontrolled front slide: ${peakFrontSlipDeg.toFixed(1)}deg`);

  return result;
}

const currentLeft = runCase('TORQUE_VECTOR', 1);
const openLeft = runCase('OPEN', 1);
const currentRight = runCase('TORQUE_VECTOR', -1);
const openRight = runCase('OPEN', -1);

function mirrorError(a: number, b: number): number {
  return Math.abs(Math.abs(a) - Math.abs(b)) / Math.max(0.25, (Math.abs(a) + Math.abs(b)) * 0.5);
}

for (const [label, left, right] of [
  ['current', currentLeft, currentRight],
  ['open-front', openLeft, openRight],
] as const) {
  assert(mirrorError(left.tail.frontSlipDeg, right.tail.frontSlipDeg) < 0.08,
    `${label}: front-slip left/right mirror drifted`);
  assert(mirrorError(left.tail.latG, right.tail.latG) < 0.08,
    `${label}: lateral-G left/right mirror drifted`);
  assert(mirrorError(left.tail.yawDegS, right.tail.yawDegS) < 0.10,
    `${label}: yaw left/right mirror drifted`);
}

const delta = {
  tailFrontSlipDeg: currentLeft.tail.frontSlipDeg - openLeft.tail.frontSlipDeg,
  peakFrontSlipDeg: currentLeft.peakFrontSlipDeg - openLeft.peakFrontSlipDeg,
  tailInsideFrontKappa: currentLeft.tail.insideFrontKappa - openLeft.tail.insideFrontKappa,
  tailOutsideFrontKappa: currentLeft.tail.outsideFrontKappa - openLeft.tail.outsideFrontKappa,
  tailYawDegS: Math.abs(currentLeft.tail.yawDegS) - Math.abs(openLeft.tail.yawDegS),
  tailLatG: currentLeft.tail.latG - openLeft.tail.latG,
  tailSpeedKmh: currentLeft.tail.speedKmh - openLeft.tail.speedKmh,
};

console.log(JSON.stringify({
  scenario: 'M5 front differential powered-corner A/B',
  startSpeedKmh: START_SPEED_KMH,
  handAngleDeg: HAND_ANGLE_DEG,
  tcsMode: config.tcsMode,
  rearDifferentialType: config.differentialType,
  currentLeft,
  openLeft,
  currentRight,
  openRight,
  deltaCurrentMinusOpen: delta,
  note: 'Measurement-only diagnostic. No production front-differential override is configured.',
}, null, 2));

console.log('FrontDifferentialCornerExitTests: PASS');

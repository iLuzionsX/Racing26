import assert from 'node:assert/strict';
import type { ControlInputs, VehicleConfig } from '../../types';
import { Simulation, type SimulationControlInputs } from '../Simulation';
import { ProvingGroundSurfaceProvider } from '../SurfaceProvider';
import { DEFAULT_VEHICLE_CONFIG } from '../vehiclePresets';
import { BMW_M5_2025_OVERRIDES } from '../m5G90';

const TOTAL_SEC = 2;
const START_SPEED_MS = 25;
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

function uniformPattern(hz: number): number[] {
  const frames = Math.round(TOTAL_SEC * hz);
  return new Array(frames).fill(TOTAL_SEC / frames);
}

function jitterPattern(): number[] {
  const values: number[] = [];
  let seed = 0x5eed1234 >>> 0;
  let sum = 0;
  while (sum < TOTAL_SEC - 1e-9) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const unit = seed / 0x100000000;
    let dt = 1 / 240 + unit * (1 / 30 - 1 / 240);
    dt = Math.min(dt, TOTAL_SEC - sum);
    values.push(dt);
    sum += dt;
  }
  return values;
}

const patterns: Record<string, number[]> = {
  '30Hz': uniformPattern(30),
  '60Hz': uniformPattern(60),
  '90Hz': uniformPattern(90),
  '120Hz': uniformPattern(120),
  '240Hz': uniformPattern(240),
  jitter: jitterPattern(),
};

function makeRollingM5(): Simulation {
  const sim = new Simulation(config, new ProvingGroundSurfaceProvider());
  sim.reset(0, 0, 0);
  sim.vehicle.powertrain.isAutomatic = false;
  (sim.vehicle.powertrain as any).gear = 0;
  for (let i = 0; i < 240; i++) sim.stepExplicit(neutral, 1);
  sim.vehicle.rigidBody.velocity.x = 0;
  sim.vehicle.rigidBody.velocity.z = START_SPEED_MS;
  for (const wheel of sim.vehicle.wheels) wheel.reset(START_SPEED_MS);
  for (let i = 0; i < 60; i++) sim.stepExplicit(neutral, 1);
  sim.resetDigitalSteeringInput(0);
  return sim;
}

function run(pattern: number[], direction: 1 | -1) {
  const sim = makeRollingM5();
  const input: SimulationControlInputs = {
    ...neutral,
    digitalSteerDirection: direction,
  };

  const startStep = sim.stepCount;
  for (const dt of pattern) sim.advance(dt, input);

  const state = sim.vehicle.getState();
  return {
    fixedSteps: sim.stepCount - startStep,
    digital: sim.digitalSteeringInput,
    x: state.x,
    z: state.z,
    yaw: state.yaw,
    yawRate: state.yawRate,
    speedMs: state.speedMs,
    actualSteer: state.actualSteerAngle,
    frontSlip: Math.max(
      Math.abs(state.wheels[0].slipAngle),
      Math.abs(state.wheels[1].slipAngle)
    ),
  };
}

const leftRuns = Object.entries(patterns).map(([name, pattern]) => ({
  name,
  ...run(pattern, 1),
}));
const rightRuns = Object.entries(patterns).map(([name, pattern]) => ({
  name,
  ...run(pattern, -1),
}));

const reference = leftRuns.find((entry) => entry.name === '120Hz')!;
for (const result of leftRuns) {
  assert.equal(result.fixedSteps, 240, `${result.name}: expected exactly 240 fixed steps`);
  assert(
    Math.abs(result.digital - reference.digital) < 1e-10,
    `${result.name}: digital steering diverged from 120Hz by ${result.digital - reference.digital}`
  );
  assert(Math.abs(result.x - reference.x) < 1e-8, `${result.name}: lateral trajectory depends on render cadence`);
  assert(Math.abs(result.z - reference.z) < 1e-8, `${result.name}: longitudinal trajectory depends on render cadence`);
  assert(Math.abs(result.yaw - reference.yaw) < 1e-9, `${result.name}: yaw depends on render cadence`);
  assert(Math.abs(result.yawRate - reference.yawRate) < 1e-9, `${result.name}: yaw rate depends on render cadence`);
  assert(Math.abs(result.actualSteer - reference.actualSteer) < 1e-10, `${result.name}: rack angle depends on render cadence`);
  assert(Math.abs(result.frontSlip - reference.frontSlip) < 1e-9, `${result.name}: tire slip depends on render cadence`);
}

const left = leftRuns.find((entry) => entry.name === '120Hz')!;
const right = rightRuns.find((entry) => entry.name === '120Hz')!;

console.log(JSON.stringify({
  scenario: 'Digital Driver V3 render-frame invariance',
  leftRuns,
  rightRuns,
  mirrorDelta: {
    digital: left.digital + right.digital,
    x: left.x + right.x,
    yaw: left.yaw + right.yaw,
    yawRate: left.yawRate + right.yawRate,
    actualSteer: left.actualSteer + right.actualSteer,
  },
}, null, 2));

// The pure DigitalSteeringInput helper is already held to exact mirror symmetry
// in DigitalSteeringInputTests. The complete chassis solver contains iterative
// tire/suspension state, so judge the full vehicle with tight physical tolerances
// instead of requiring bit-identical mirrored floating-point trajectories.
assert(
  Math.abs(left.digital + right.digital) < 1e-4,
  `full-vehicle digital request mirror drift too large: left=${left.digital}, right=${right.digital}`
);
assert(
  Math.abs(left.x + right.x) < 0.05,
  `lateral mirror error exceeds 5 cm: ${left.x + right.x} m`
);
assert(
  Math.abs(left.yaw + right.yaw) < 0.01,
  `yaw mirror error exceeds 0.01 rad: ${left.yaw + right.yaw}`
);
assert(
  Math.abs(left.yawRate + right.yawRate) < 0.025,
  `instantaneous yaw-rate mirror error exceeds 0.025 rad/s: ${left.yawRate + right.yawRate}`
);
assert(
  Math.abs(left.actualSteer + right.actualSteer) < 2e-4,
  `rack-angle mirror error exceeds 0.0002 rad: ${left.actualSteer + right.actualSteer}`
);

console.log('DigitalSteeringFrameRateInvarianceTests: PASS');

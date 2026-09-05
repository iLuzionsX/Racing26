import assert from 'node:assert/strict';
import type { ControlInputs, VehicleConfig } from '../../types';
import { Simulation, type SimulationControlInputs } from '../Simulation';
import { ProvingGroundSurfaceProvider } from '../SurfaceProvider';
import { DEFAULT_VEHICLE_CONFIG } from '../vehiclePresets';
import { BMW_M5_2025_OVERRIDES } from '../m5G90';

const TOTAL_SEC = 1.0;
const START_SPEED_MS = 25;
const TARGET = 0.08;
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

function pattern(hz: number) {
  const frames = Math.round(TOTAL_SEC * hz);
  return new Array(frames).fill(TOTAL_SEC / frames);
}

function makeRollingM5() {
  const sim = new Simulation(config, new ProvingGroundSurfaceProvider());
  sim.reset(0, 0, 0);
  sim.vehicle.powertrain.isAutomatic = false;
  (sim.vehicle.powertrain as any).gear = 0;
  for (let i = 0; i < 240; i++) sim.stepExplicit(neutral, 1);
  sim.vehicle.rigidBody.velocity.x = 0;
  sim.vehicle.rigidBody.velocity.z = START_SPEED_MS;
  for (const wheel of sim.vehicle.wheels) wheel.reset(START_SPEED_MS);
  for (let i = 0; i < 60; i++) sim.stepExplicit(neutral, 1);
  sim.resetAnalogSteeringInput(0);
  return sim;
}

function run(hz: number, target: number) {
  const sim = makeRollingM5();
  const input: SimulationControlInputs = {
    ...neutral,
    analogSteerTarget: target,
  };
  const startStep = sim.stepCount;
  for (const dt of pattern(hz)) sim.advance(dt, input);
  const state = sim.vehicle.getState();
  return {
    fixedSteps: sim.stepCount - startStep,
    analog: sim.analogSteeringInput,
    x: state.x,
    z: state.z,
    yaw: state.yaw,
    yawRate: state.yawRate,
    actualSteer: state.actualSteerAngle,
  };
}

const baselineLeft = run(120, TARGET);
const baselineRight = run(120, -TARGET);
const results = [30, 60, 90, 120, 240].map((hz) => ({
  hz,
  left: run(hz, TARGET),
  right: run(hz, -TARGET),
}));

for (const { hz, left, right } of results) {
  assert.equal(left.fixedSteps, baselineLeft.fixedSteps, `${hz}Hz left fixed-step count differs`);
  assert.equal(right.fixedSteps, baselineRight.fixedSteps, `${hz}Hz right fixed-step count differs`);
  assert(Math.abs(left.analog - baselineLeft.analog) < 1e-12, `${hz}Hz analog input drifted`);
  assert(Math.abs(right.analog - baselineRight.analog) < 1e-12, `${hz}Hz mirrored analog input drifted`);
  assert(Math.abs(left.x - baselineLeft.x) < 0.03, `${hz}Hz left trajectory changed`);
  assert(Math.abs(right.x - baselineRight.x) < 0.03, `${hz}Hz right trajectory changed`);
  assert(Math.abs(left.yaw - baselineLeft.yaw) < 0.005, `${hz}Hz left yaw changed`);
  assert(Math.abs(right.yaw - baselineRight.yaw) < 0.005, `${hz}Hz right yaw changed`);
  assert(Math.abs(left.actualSteer - baselineLeft.actualSteer) < 2e-4, `${hz}Hz left rack changed`);
  assert(Math.abs(right.actualSteer - baselineRight.actualSteer) < 2e-4, `${hz}Hz right rack changed`);
}

assert(Math.abs(baselineLeft.x + baselineRight.x) < 0.08, 'analog left/right trajectory is not mirrored');
assert(Math.abs(baselineLeft.yaw + baselineRight.yaw) < 0.015, 'analog left/right yaw is not mirrored');
assert(Math.abs(baselineLeft.actualSteer + baselineRight.actualSteer) < 2e-4, 'analog left/right rack is not mirrored');

console.log(JSON.stringify({ target: TARGET, results }, null, 2));
console.log('AnalogSteeringFrameRateInvarianceTests: PASS');

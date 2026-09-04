import assert from 'node:assert/strict';
import type { ControlInputs, VehicleConfig } from '../../types';
import { Simulation } from '../Simulation';
import { ProvingGroundSurfaceProvider } from '../SurfaceProvider';
import { DEFAULT_VEHICLE_CONFIG } from '../vehiclePresets';
import { BMW_M5_2025_OVERRIDES } from '../m5G90';
import { PhysicsMath } from '../math/PhysicsMath';

// Rear-wheel-steering invariant checks for G90 M5.
// Canonical order [FL, FR, RL, RR]; +X left, +Z forward; +steer and +yaw mean left.
// Low speed: rear opposite phase. High speed: rear same phase. Transition must be smooth.
const DEG = 180 / Math.PI;
const M5_CONFIG = { ...DEFAULT_VEHICLE_CONFIG, ...BMW_M5_2025_OVERRIDES } as VehicleConfig & Record<string, any>;
const NEUTRAL: ControlInputs = { throttle: 0, brake: 0, steer: 0, handbrake: false, shiftUp: false, shiftDown: false };
const REAR_MAX_RAD = (Number(M5_CONFIG.rearSteerMaxDeg ?? 1.5) * Math.PI) / 180;
const TRANSITION_MS = Number(M5_CONFIG.rearSteerTransitionSpeedMs ?? 20.0);

function makeRollingM5(speedMs: number): Simulation {
  const sim = new Simulation(M5_CONFIG, new ProvingGroundSurfaceProvider());
  sim.reset(0, 0, 0);
  sim.vehicle.powertrain.isAutomatic = false;
  sim.vehicle.powertrain.gear = 0;
  sim.vehicle.rigidBody.velocity = PhysicsMath.vec3(0, 0, speedMs);
  for (const w of sim.vehicle.wheels) w.reset(speedMs);
  for (let i = 0; i < 60; i++) sim.stepExplicit(NEUTRAL, 1);
  return sim;
}

function measureCenters(speedMs: number, steer: number, settleSteps = 150) {
  const sim = makeRollingM5(speedMs);
  let state: any = null;
  for (let i = 0; i < settleSteps; i++) state = sim.stepExplicit({ ...NEUTRAL, steer }, 1);
  const fl = state.wheels[0].steerAngle;
  const fr = state.wheels[1].steerAngle;
  const rl = state.wheels[2].steerAngle;
  const rr = state.wheels[3].steerAngle;
  const frontCenter = (fl + fr) / 2;
  const rearCenter = (rl + rr) / 2;
  const lv = sim.vehicle.rigidBody.getLocalVelocity();
  const sideslip = Math.atan2(lv.x, Math.max(0.5, Math.abs(lv.z)));
  return { sim, state, fl, fr, rl, rr, frontCenter, rearCenter, yawRate: state.yawRate, sideslip };
}

// Low speed opposite phase: 8 m/s left turn.
const low = measureCenters(8.0, 0.30);
assert(low.frontCenter > 0.05, 'low-speed front center too small, maneuver invalid');
assert(low.rearCenter < -0.0008, 'low-speed rear must be opposite phase to front for left turn');
assert(Math.abs(low.rearCenter) <= REAR_MAX_RAD + 0.002, 'low-speed rear exceeds max rear steer');
assert(Math.abs(low.rl - low.rr) < 0.003, 'rear left/right must stay symmetric at low speed');

// High speed same phase: 120 km/h left turn.
const highLeft = measureCenters(33.333, 0.10);
assert(highLeft.frontCenter > 0.02, 'high-speed front center too small, maneuver invalid');
assert(highLeft.rearCenter > 0.0008, 'high-speed rear must be same phase as front for left turn');
assert(highLeft.rearCenter <= REAR_MAX_RAD + 0.002, 'high-speed rear exceeds max rear steer');
assert(highLeft.rearCenter / Math.max(1e-6, highLeft.frontCenter) < 0.45, 'high-speed rear gain implausibly large');
assert(highLeft.rearCenter / Math.max(1e-6, highLeft.frontCenter) > 0.0, 'high-speed rear gain must be positive');

// Transition continuity around configured transition speed.
const sweepSpeeds = [TRANSITION_MS - 4, TRANSITION_MS - 2, TRANSITION_MS, TRANSITION_MS + 2, TRANSITION_MS + 4].filter((v) => v > 3);
const sweep = sweepSpeeds.map((v) => measureCenters(v, 0.15));
// Simplify: rearCenter signed divided by front magnitude preserves sign for left-turn sweep.
const signedGains = sweep.map((s) => s.rearCenter / Math.max(1e-6, Math.abs(s.frontCenter)));
for (let i = 1; i < signedGains.length; i++) {
  assert(signedGains[i] >= signedGains[i - 1] - 0.02, 'rear gain must increase monotonically through transition');
}
let maxRearStep = 0;
for (let i = 1; i < sweep.length; i++) maxRearStep = Math.max(maxRearStep, Math.abs(sweep[i].rearCenter - sweep[i - 1].rearCenter));
assert(maxRearStep < 0.012, 'rear angle step across 2 m/s must stay smooth, no jump at transition');
assert(signedGains[0] < 0, 'gain well below transition must still be opposite phase');
assert(signedGains[signedGains.length - 1] > 0, 'gain well above transition must be same phase');

// Mirrored right turn at same high speed.
const highRight = measureCenters(33.333, -0.10);
assert(Math.abs(Math.abs(highLeft.frontCenter) - Math.abs(highRight.frontCenter)) < 0.004, 'front left/right magnitudes must mirror');
assert(Math.abs(Math.abs(highLeft.rearCenter) - Math.abs(highRight.rearCenter)) < 0.002, 'rear left/right magnitudes must mirror');
assert(highRight.rearCenter < -0.0008, 'high-speed right turn rear must mirror to same phase');
assert(Math.abs(highLeft.yawRate + highRight.yawRate) < 0.03 + 0.10 * Math.max(Math.abs(highLeft.yawRate), Math.abs(highRight.yawRate)), 'yaw must mirror left/right');

// Yaw stability at 120 km/h: no spin, bounded sideslip.
assert(highLeft.yawRate > 0, 'left turn must produce positive yaw rate');
assert(highRight.yawRate < 0, 'right turn must produce negative yaw rate');
assert(Math.abs(highLeft.sideslip) < (8 * Math.PI) / 180, 'high-speed sideslip must stay below 8 deg');
assert(Math.abs(highLeft.yawRate) < 0.60, 'high-speed yaw rate diverged toward spin');
assert(Number.isFinite(highLeft.yawRate) && Number.isFinite(highLeft.sideslip), 'non-finite yaw state');

console.log(JSON.stringify({ lowRearDeg: low.rearCenter * DEG, highLeftRearDeg: highLeft.rearCenter * DEG, highRightRearDeg: highRight.rearCenter * DEG, maxRearStepDeg: maxRearStep * DEG, signedGains, status: 'passed' }));
console.log('RearWheelSteeringTests: PASS');

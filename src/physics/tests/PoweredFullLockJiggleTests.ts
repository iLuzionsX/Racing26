import assert from 'node:assert/strict';
import type { ControlInputs, VehicleConfig } from '../../types';
import { Simulation } from '../Simulation';
import { ProvingGroundSurfaceProvider } from '../SurfaceProvider';
import { DEFAULT_VEHICLE_CONFIG } from '../vehiclePresets';
import { BMW_M5_2025_OVERRIDES } from '../m5G90';
import { PhysicsMath } from '../math/PhysicsMath';

const HZ = 120;
const TARGET_SPEED_MS = 10 / 3.6;
const DEG = 180 / Math.PI;
const config = {
  ...DEFAULT_VEHICLE_CONFIG,
  ...BMW_M5_2025_OVERRIDES,
} as VehicleConfig;

const baseInputs: ControlInputs = {
  throttle: 0,
  brake: 0,
  steer: 1,
  handbrake: false,
  shiftUp: false,
  shiftDown: false,
};

const range = (values: number[]) => Math.max(...values) - Math.min(...values);
const rms = (values: number[]) =>
  Math.sqrt(values.reduce((sum, value) => sum + value * value, 0) / Math.max(1, values.length));

function detrendedRms(values: number[], halfWindow: number) {
  if (values.length <= halfWindow * 2 + 1) return 0;
  const residuals: number[] = [];
  for (let i = halfWindow; i < values.length - halfWindow; i++) {
    let sum = 0;
    for (let j = i - halfWindow; j <= i + halfWindow; j++) sum += values[j];
    residuals.push(values[i] - sum / (halfWindow * 2 + 1));
  }
  return rms(residuals);
}

function makeAtTenKmh(automaticDrive: boolean) {
  const sim = new Simulation(config, new ProvingGroundSurfaceProvider());
  sim.reset(0, 0, 0);

  sim.vehicle.powertrain.isAutomatic = false;
  sim.vehicle.powertrain.gear = 0;
  for (let i = 0; i < HZ * 3; i++) sim.stepExplicit({ ...baseInputs, steer: 0 }, 1);

  sim.vehicle.rigidBody.velocity = PhysicsMath.vec3(0, 0, TARGET_SPEED_MS);
  for (const wheel of sim.vehicle.wheels) wheel.reset(TARGET_SPEED_MS);

  sim.vehicle.powertrain.isAutomatic = automaticDrive;
  sim.vehicle.powertrain.gear = automaticDrive ? 1 : 0;
  sim.vehicle.powertrain.engineRpm = config.idleRpm;
  sim.vehicle.powertrain.flywheelRpm = config.idleRpm;
  return sim;
}

type ScenarioMode = 'neutral-coast' | 'automatic-creep' | 'automatic-speed-hold';

function runScenario(mode: ScenarioMode) {
  const sim = makeAtTenKmh(mode !== 'neutral-coast');
  const totalSteps = HZ * 6;
  const steadyStart = HZ * 2;

  const speed: number[] = [];
  const roll: number[] = [];
  const heave: number[] = [];
  const lateralG: number[] = [];
  const yawRate: number[] = [];
  const wheelTravel = [[], [], [], []] as number[][];
  const tireLoad = [[], [], [], []] as number[][];
  const airborneToggles = [0, 0, 0, 0];
  const previousAirborne = [false, false, false, false];
  let throttleMin = Infinity;
  let throttleMax = -Infinity;

  for (let step = 0; step < totalSteps; step++) {
    const currentSpeedMs = Math.abs(sim.vehicle.rigidBody.getLocalVelocity().z);
    let throttle = 0;
    if (mode === 'automatic-speed-hold') {
      // A deliberately soft driver-like correction keeps the maneuver centered
      // around 10 km/h without injecting a sharp closed-loop throttle oscillation.
      const error = TARGET_SPEED_MS - currentSpeedMs;
      throttle = PhysicsMath.clamp(0.055 + error * 0.055, 0, 0.18);
    }
    throttleMin = Math.min(throttleMin, throttle);
    throttleMax = Math.max(throttleMax, throttle);

    const state = sim.stepExplicit({ ...baseInputs, throttle }, 1);
    for (let i = 0; i < 4; i++) {
      const airborne = state.wheels[i].isAirborne;
      if (step > 0 && airborne !== previousAirborne[i]) airborneToggles[i]++;
      previousAirborne[i] = airborne;
    }

    if (step < steadyStart) continue;
    speed.push(state.speedKmh);
    roll.push(state.roll * DEG);
    heave.push(state.heave * 1000);
    lateralG.push(state.lateralG);
    yawRate.push(state.yawRate * DEG);
    for (let i = 0; i < 4; i++) {
      wheelTravel[i].push(state.wheels[i].verticalTravelM * 1000);
      tireLoad[i].push(state.wheels[i].forceVectorNorm);
    }
  }

  const oneSecondHalfWindow = Math.floor(HZ * 0.5);
  const fastHalfWindow = 8;
  const result = {
    mode,
    throttleRange: [throttleMin, throttleMax],
    speedKmh: {
      min: Math.min(...speed),
      max: Math.max(...speed),
      p2p: range(speed),
    },
    roll: {
      p2pDeg: range(roll),
      detrendedRmsDeg: detrendedRms(roll, oneSecondHalfWindow),
      fastRmsDeg: detrendedRms(roll, fastHalfWindow),
    },
    heave: {
      p2pMm: range(heave),
      detrendedRmsMm: detrendedRms(heave, oneSecondHalfWindow),
    },
    lateralG: {
      p2p: range(lateralG),
      detrendedRms: detrendedRms(lateralG, oneSecondHalfWindow),
    },
    yawRate: {
      p2pDegS: range(yawRate),
      detrendedRmsDegS: detrendedRms(yawRate, oneSecondHalfWindow),
    },
    wheelTravelP2pMm: wheelTravel.map(range),
    wheelTravelDetrendedRmsMm: wheelTravel.map((values) =>
      detrendedRms(values, oneSecondHalfWindow)
    ),
    tireLoadP2pN: tireLoad.map(range),
    tireLoadDetrendedRmsN: tireLoad.map((values) =>
      detrendedRms(values, oneSecondHalfWindow)
    ),
    airborneToggles,
  };

  assert(speed.every(Number.isFinite), `${mode}: non-finite speed`);
  assert(roll.every(Number.isFinite), `${mode}: non-finite roll`);
  assert(
    airborneToggles.every((count) => count === 0),
    `${mode}: wheel contact toggled ${airborneToggles.join(',')}`
  );
  return result;
}

const neutral = runScenario('neutral-coast');
const creep = runScenario('automatic-creep');
const powered = runScenario('automatic-speed-hold');

// Neutral/coast should settle almost completely once the steering transient has passed.
assert(neutral.roll.detrendedRmsDeg < 0.03, `neutral roll residual ${neutral.roll.detrendedRmsDeg.toFixed(3)} deg RMS`);
assert(Math.max(...neutral.wheelTravelDetrendedRmsMm) < 0.5, 'neutral suspension remains visibly active');

// The live-drivetrain full-lock case is the user-visible regression. Allow the body
// to take a physical cornering set, but reject continuing jelly-like pumping around
// that moving mean. These limits are intentionally above the validated production
// trace while remaining far below the old 3+ degree / 30+ mm failure signature.
assert(powered.speedKmh.min > 8.5 && powered.speedKmh.max < 13.0, `powered speed escaped 10 km/h band: ${powered.speedKmh.min.toFixed(2)}-${powered.speedKmh.max.toFixed(2)}`);
assert(powered.roll.detrendedRmsDeg < 0.30, `powered roll jiggle ${powered.roll.detrendedRmsDeg.toFixed(3)} deg RMS`);
assert(powered.roll.p2pDeg < 1.0, `powered roll swing ${powered.roll.p2pDeg.toFixed(3)} deg p2p`);
assert(Math.max(...powered.wheelTravelDetrendedRmsMm) < 3.0, `powered suspension jiggle ${Math.max(...powered.wheelTravelDetrendedRmsMm).toFixed(2)} mm RMS`);
assert(Math.max(...powered.wheelTravelP2pMm) < 10.0, `powered suspension swing ${Math.max(...powered.wheelTravelP2pMm).toFixed(2)} mm p2p`);
assert(Math.max(...powered.tireLoadDetrendedRmsN) < 700, `powered tire-load pumping ${Math.max(...powered.tireLoadDetrendedRmsN).toFixed(0)} N RMS`);
assert(powered.yawRate.detrendedRmsDegS < 5.0, `powered yaw-rate pumping ${powered.yawRate.detrendedRmsDegS.toFixed(2)} deg/s RMS`);

console.log(JSON.stringify({
  scenario: '2025 M5 10 km/h full-lock powered stability regression',
  neutral,
  creep,
  powered,
}, null, 2));
console.log('PoweredFullLockJiggleTests: PASS');

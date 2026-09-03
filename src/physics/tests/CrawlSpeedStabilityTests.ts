import assert from 'node:assert/strict';
import type { ControlInputs, VehicleConfig } from '../../types';
import { Simulation } from '../Simulation';
import { ProvingGroundSurfaceProvider } from '../SurfaceProvider';
import { DEFAULT_VEHICLE_CONFIG } from '../vehiclePresets';
import { BMW_M5_2025_OVERRIDES } from '../m5G90';

const DT = 1 / 120;
const START_SPEED_MS = 6 / 3.6;

const baseInputs: ControlInputs = {
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
} as VehicleConfig;

function runScenario(steer: number, label: string) {
  const sim = new Simulation(config, new ProvingGroundSurfaceProvider());
  sim.reset(0, 0, 0);
  sim.vehicle.powertrain.isAutomatic = false;
  sim.vehicle.powertrain.gear = 0;
  sim.vehicle.rigidBody.velocity.z = START_SPEED_MS;
  for (const wheel of sim.vehicle.wheels) wheel.angularVelocity = START_SPEED_MS / config.wheelRadius;

  let previousYawRate = 0;
  let previousRoll = 0;
  let previousFrontFy = 0;
  let previousOmegas = sim.vehicle.wheels.map((wheel) => wheel.angularVelocity);
  let maxYawAccel = 0;
  let maxRollStep = 0;
  let maxWheelOmegaStep = 0;
  let maxSkidIntensity = 0;
  let maxFrontSlipDeg = 0;
  let frontForceSignFlips = 0;
  let rollSignFlips = 0;
  let samples = 0;

  for (let step = 0; step < 360; step++) {
    const state = sim.stepExplicit({ ...baseInputs, steer }, 1);
    const yawRate = state.yawRate;
    const roll = state.roll;
    const frontFy = state.wheels[0].forceVectorLat + state.wheels[1].forceVectorLat;

    if (step > 60) {
      maxYawAccel = Math.max(maxYawAccel, Math.abs(yawRate - previousYawRate) / DT);
      maxRollStep = Math.max(maxRollStep, Math.abs(roll - previousRoll));
      if (Math.abs(frontFy) > 250 && Math.abs(previousFrontFy) > 250 && Math.sign(frontFy) !== Math.sign(previousFrontFy)) {
        frontForceSignFlips++;
      }
      if (Math.abs(roll) > 0.001 && Math.abs(previousRoll) > 0.001 && Math.sign(roll) !== Math.sign(previousRoll)) {
        rollSignFlips++;
      }
    }

    state.wheels.forEach((wheelState, index) => {
      maxSkidIntensity = Math.max(maxSkidIntensity, wheelState.skidIntensity);
      if (index < 2) maxFrontSlipDeg = Math.max(maxFrontSlipDeg, Math.abs(wheelState.slipAngle) * 180 / Math.PI);
      const omega = sim.vehicle.wheels[index].angularVelocity;
      maxWheelOmegaStep = Math.max(maxWheelOmegaStep, Math.abs(omega - previousOmegas[index]));
      previousOmegas[index] = omega;
    });

    previousYawRate = yawRate;
    previousRoll = roll;
    previousFrontFy = frontFy;
    samples++;
  }

  const final = sim.vehicle.getState();
  return {
    label,
    steer,
    samples,
    finalSpeedKmh: final.speedKmh,
    maxYawAccelRadPerSec2: maxYawAccel,
    maxRollStepRad: maxRollStep,
    maxWheelOmegaStepRadPerSec: maxWheelOmegaStep,
    maxFrontSlipDeg,
    maxSkidIntensity,
    frontForceSignFlips,
    rollSignFlips,
  };
}

const straight = runScenario(0, 'straight');
const mediumTurn = runScenario(0.5, 'medium-turn');
const fullLock = runScenario(1.0, 'full-lock');

console.log(JSON.stringify({
  scenario: 'M5 crawl-speed stability at 6 km/h',
  straight,
  mediumTurn,
  fullLock,
}, null, 2));

// At a constant steering command, tire force and body roll should not chatter
// left/right. These are intentionally broad physical invariants; detailed tuning
// comes after we identify the transition source.
assert(straight.frontForceSignFlips === 0, `6 km/h straight run flipped front lateral force ${straight.frontForceSignFlips} times`);
assert(mediumTurn.frontForceSignFlips <= 1, `6 km/h medium turn chattered front lateral force ${mediumTurn.frontForceSignFlips} times`);
assert(fullLock.frontForceSignFlips <= 1, `6 km/h full-lock turn chattered front lateral force ${fullLock.frontForceSignFlips} times`);
assert(mediumTurn.rollSignFlips <= 1, `6 km/h medium turn oscillated body roll ${mediumTurn.rollSignFlips} times`);
assert(fullLock.rollSignFlips <= 1, `6 km/h full-lock turn oscillated body roll ${fullLock.rollSignFlips} times`);

console.log('CrawlSpeedStabilityTests: PASS');

import assert from 'node:assert/strict';
import type { ControlInputs, VehicleConfig } from '../../types';
import { Simulation } from '../Simulation';
import { ProvingGroundSurfaceProvider } from '../SurfaceProvider';
import { DEFAULT_VEHICLE_CONFIG } from '../vehiclePresets';
import { BMW_M5_2025_OVERRIDES } from '../m5G90';
import { updateDigitalSteeringInput } from '../DigitalSteeringInput';

const DT = 1 / 120;
const START_SPEED_MS = 50 / 3.6;
const DEG = 180 / Math.PI;
const REAL_M5_SKIDPAD_G = 0.98;

const zeroInputs: ControlInputs = {
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

function makeRollingM5() {
  const sim = new Simulation(config, new ProvingGroundSurfaceProvider());
  sim.reset(0, 0, 0);
  sim.vehicle.powertrain.isAutomatic = false;
  sim.vehicle.powertrain.gear = 0;
  sim.vehicle.rigidBody.velocity.z = START_SPEED_MS;
  for (const wheel of sim.vehicle.wheels) wheel.angularVelocity = START_SPEED_MS / config.wheelRadius;
  for (let i = 0; i < 60; i++) sim.stepExplicit(zeroInputs, 1);
  return sim;
}

type SteerProvider = (sim: Simulation) => number;

function mean(values: number[]) {
  return values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
}

function runTurn(
  label: string,
  steerProvider: SteerProvider,
  durationSec = 2.0,
  fullMechanicalRack = false
) {
  const sim = makeRollingM5();
  if (fullMechanicalRack) {
    // Mouse/wheel-style analog steering represents a fraction of the physical
    // rack. BMW speed sensitivity is assistance/ratio behavior, not a smaller
    // mechanical lock, so mirror the App's mouse-mode bypass here.
    sim.vehicle.driverAids.config.steerSpeedReduction = 0;
  }

  const radii: number[] = [];
  const geometricRadii: number[] = [];
  const speeds: number[] = [];
  const near50Radii: number[] = [];
  const near50Speeds: number[] = [];
  const near50LatG: number[] = [];
  const near50FrontSteer: number[] = [];
  const near50RearSteer: number[] = [];
  const near50FrontSlip: number[] = [];
  let peakLatG = 0;
  let peakFrontSlipDeg = 0;
  let peakSteerInput = 0;
  let lateMeanFrontSteerDeg = 0;
  let lateSamples = 0;

  const steps = Math.round(durationSec / DT);
  for (let step = 0; step < steps; step++) {
    const steer = steerProvider(sim);
    peakSteerInput = Math.max(peakSteerInput, Math.abs(steer));
    const state = sim.stepExplicit({ ...zeroInputs, steer }, 1);
    const localVelocity = sim.vehicle.rigidBody.getLocalVelocity();
    const speed = Math.hypot(localVelocity.x, localVelocity.z);
    const speedKmh = speed * 3.6;
    const yawRate = Math.abs(sim.vehicle.rigidBody.getLocalAngularVelocity().y);
    const frontSteer = Math.abs((state.wheels[0].steerAngle + state.wheels[1].steerAngle) * 0.5);
    const rearSteer = Math.abs((state.wheels[2].steerAngle + state.wheels[3].steerAngle) * 0.5);
    const frontSlipDeg = Math.max(
      Math.abs(state.wheels[0].slipAngle) * DEG,
      Math.abs(state.wheels[1].slipAngle) * DEG
    );

    peakLatG = Math.max(peakLatG, Math.abs(state.lateralG));
    peakFrontSlipDeg = Math.max(peakFrontSlipDeg, frontSlipDeg);

    if (step >= 18 && speedKmh >= 47.5 && speedKmh <= 50.5) {
      near50Speeds.push(speed);
      near50LatG.push(Math.abs(state.lateralG));
      near50FrontSteer.push(frontSteer * DEG);
      near50RearSteer.push(rearSteer * DEG);
      near50FrontSlip.push(frontSlipDeg);
      if (yawRate > 0.03) near50Radii.push(speed / yawRate);
    }

    if (step > 90) {
      speeds.push(speed);
      if (yawRate > 0.03) radii.push(speed / yawRate);
      if (frontSteer > 0.005) geometricRadii.push(config.wheelbase / Math.tan(frontSteer));
      lateMeanFrontSteerDeg += frontSteer * DEG;
      lateSamples++;
    }
  }

  return {
    label,
    peakSteerInput,
    near50: {
      samples: near50Speeds.length,
      meanSpeedKmh: mean(near50Speeds) * 3.6,
      meanYawRadiusM: mean(near50Radii),
      meanLatG: mean(near50LatG),
      meanFrontSteerDeg: mean(near50FrontSteer),
      meanRearSteerDeg: mean(near50RearSteer),
      meanFrontSlipDeg: mean(near50FrontSlip),
    },
    lateMeanSpeedKmh: mean(speeds) * 3.6,
    lateMeanFrontSteerDeg: lateSamples ? lateMeanFrontSteerDeg / lateSamples : 0,
    lateMeanYawRadiusM: mean(radii),
    lateMeanGeometricRadiusM: mean(geometricRadii),
    peakLatG,
    peakFrontSlipDeg,
  };
}

let shapedInput = 0;
const shapedDigital = runTurn('held keyboard/touch full-left', (sim) => {
  const speed = Math.abs(sim.vehicle.rigidBody.getLocalVelocity().z);
  shapedInput = updateDigitalSteeringInput(shapedInput, 1, speed, DT);
  return shapedInput;
});

const fullMouseLock = runTurn(
  'mouse screen-edge full-left (+1.0, full mechanical rack)',
  () => 1,
  2.0,
  true
);
const realM5GripLimitedRadiusAt50M =
  (START_SPEED_MS * START_SPEED_MS) / (REAL_M5_SKIDPAD_G * 9.81);

console.log(JSON.stringify({
  scenario: 'BMW M5 G90 50 km/h full-left turn-radius diagnostic',
  shapedDigital,
  fullMouseLock,
  realM5SkidpadG: REAL_M5_SKIDPAD_G,
  realM5GripLimitedRadiusAt50M,
}, null, 2));

assert(Number.isFinite(shapedDigital.lateMeanYawRadiusM), 'digital turn radius must be finite');
assert(Number.isFinite(fullMouseLock.lateMeanYawRadiusM), 'mouse full-lock turn radius must be finite');
assert(fullMouseLock.peakSteerInput === 1, 'mouse full-lock diagnostic must send exactly 100% steering input');
assert(fullMouseLock.near50.samples > 0, 'mouse full-lock diagnostic must capture samples while still near 50 km/h');
assert(
  fullMouseLock.near50.meanFrontSteerDeg > 30,
  `mouse full lock must reach the physical rack, got ${fullMouseLock.near50.meanFrontSteerDeg.toFixed(2)} deg`
);
console.log('TurnRadiusTests: PASS');

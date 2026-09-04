import assert from 'node:assert/strict';
import type { ControlInputs, VehicleConfig } from '../../types';
import { Simulation } from '../Simulation';
import { ProvingGroundSurfaceProvider } from '../SurfaceProvider';
import { DEFAULT_VEHICLE_CONFIG } from '../vehiclePresets';
import { BMW_M5_2025_OVERRIDES } from '../m5G90';
import { updateDigitalSteeringInput } from '../DigitalSteeringInput';

const DT = 1 / 120;
const START_SPEED_MS = 30 / 3.6;
const DEG = 180 / Math.PI;
// Diagnostic only: this is where the old solver had its hard free-roll mode switch.
const LEGACY_FREE_ROLL_SWITCH_MS = 2.6;

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

function makeRollingM5(startSpeedMs: number = START_SPEED_MS) {
  const sim = new Simulation(config, new ProvingGroundSurfaceProvider());
  sim.reset(0, 0, 0);
  sim.vehicle.powertrain.isAutomatic = false;
  sim.vehicle.powertrain.gear = 0;
  sim.vehicle.rigidBody.velocity.z = startSpeedMs;
  for (const wheel of sim.vehicle.wheels) wheel.angularVelocity = startSpeedMs / config.wheelRadius;
  for (let i = 0; i < 60; i++) sim.stepExplicit(zeroInputs, 1);
  return sim;
}

type SteerProvider = (sim: Simulation, step: number) => number;

function runCorner(label: string, steerProvider: SteerProvider, durationSec: number) {
  const sim = makeRollingM5();
  let peakFrontSlipDeg = 0;
  let peakRearSlipDeg = 0;
  let peakLatG = 0;
  let skidSamples = 0;
  let frontSkidSamples = 0;
  let rearSkidSamples = 0;
  let yawRatioSum = 0;
  let yawRatioSamples = 0;
  let meanFrontSteerDeg = 0;
  let finalSpeedKmh = 0;
  let peakSteerInput = 0;
  let entryPeakSteerInput = 0;

  const totalSteps = Math.round(durationSec / DT);
  for (let step = 0; step < totalSteps; step++) {
    const steerInput = steerProvider(sim, step);
    peakSteerInput = Math.max(peakSteerInput, Math.abs(steerInput));
    if (step < Math.round(0.50 / DT)) {
      entryPeakSteerInput = Math.max(entryPeakSteerInput, Math.abs(steerInput));
    }
    const state = sim.stepExplicit({ ...zeroInputs, steer: steerInput }, 1);
    const frontSteer = (state.wheels[0].steerAngle + state.wheels[1].steerAngle) * 0.5;
    meanFrontSteerDeg = Math.abs(frontSteer) * DEG;
    finalSpeedKmh = state.speedKmh;

    const frontSlip = Math.max(Math.abs(state.wheels[0].slipAngle), Math.abs(state.wheels[1].slipAngle)) * DEG;
    const rearSlip = Math.max(Math.abs(state.wheels[2].slipAngle), Math.abs(state.wheels[3].slipAngle)) * DEG;
    peakFrontSlipDeg = Math.max(peakFrontSlipDeg, frontSlip);
    peakRearSlipDeg = Math.max(peakRearSlipDeg, rearSlip);
    peakLatG = Math.max(peakLatG, Math.abs(state.lateralG));

    const frontSkid = state.wheels[0].isSkidding || state.wheels[1].isSkidding;
    const rearSkid = state.wheels[2].isSkidding || state.wheels[3].isSkidding;
    if (frontSkid || rearSkid) skidSamples++;
    if (frontSkid) frontSkidSamples++;
    if (rearSkid) rearSkidSamples++;

    if (step > 60 && Math.abs(frontSteer) > 0.01) {
      const localSpeed = Math.abs(sim.vehicle.rigidBody.getLocalVelocity().z);
      const targetYawRate = localSpeed * Math.tan(frontSteer) / config.wheelbase;
      const actualYawRate = sim.vehicle.rigidBody.getLocalAngularVelocity().y;
      if (Math.abs(targetYawRate) > 0.05) {
        yawRatioSum += Math.abs(actualYawRate / targetYawRate);
        yawRatioSamples++;
      }
    }
  }

  return {
    label,
    peakSteerInput,
    entryPeakSteerInput,
    meanFrontSteerDeg,
    peakFrontSlipDeg,
    peakRearSlipDeg,
    peakLatG,
    skidSamples,
    frontSkidSamples,
    rearSkidSamples,
    meanYawResponseRatio: yawRatioSamples ? yawRatioSum / yawRatioSamples : 0,
    finalSpeedKmh,
  };
}

function runTenKmhFullLockDiagnostic() {
  const sim = makeRollingM5(10 / 3.6);
  const transientWindowSteps = Math.round(0.75 / DT);
  const steadyWindowStart = Math.round(2.0 / DT);
  const totalSteps = Math.round(4.0 / DT);

  let entrySpeedKmh = 0;
  let finalSpeedKmh = 0;
  let heaveMin = Infinity;
  let heaveMax = -Infinity;
  let rollMin = Infinity;
  let rollMax = -Infinity;
  let rollRatePeakDegS = 0;
  let verticalGMin = Infinity;
  let verticalGMax = -Infinity;
  const travelMin = [Infinity, Infinity, Infinity, Infinity];
  const travelMax = [-Infinity, -Infinity, -Infinity, -Infinity];
  const loadMin = [Infinity, Infinity, Infinity, Infinity];
  const loadMax = [-Infinity, -Infinity, -Infinity, -Infinity];
  const damperVelocityPeak = [0, 0, 0, 0];
  const airborneToggles = [0, 0, 0, 0];
  const previousAirborne = [false, false, false, false];

  let steadyHeaveMin = Infinity;
  let steadyHeaveMax = -Infinity;
  let steadyRollMin = Infinity;
  let steadyRollMax = -Infinity;
  let steadyRollRatePeakDegS = 0;
  const steadyTravelMin = [Infinity, Infinity, Infinity, Infinity];
  const steadyTravelMax = [-Infinity, -Infinity, -Infinity, -Infinity];
  const steadyLoadMin = [Infinity, Infinity, Infinity, Infinity];
  const steadyLoadMax = [-Infinity, -Infinity, -Infinity, -Infinity];
  const legacyBoundaryCrossings = [0, 0, 0, 0];
  const previousBoundarySide = [0, 0, 0, 0];
  const longitudinalForceSignFlips = [0, 0, 0, 0];
  const previousLongForceSign = [0, 0, 0, 0];
  let steadyRollRateReversals = 0;
  let previousRollRateSign = 0;
  let heaveVelocityReversals = 0;
  let previousHeaveVelocitySign = 0;

  for (let step = 0; step < totalSteps; step++) {
    const state = sim.stepExplicit({ ...zeroInputs, steer: 1.0 }, 1);
    if (step === 0) entrySpeedKmh = state.speedKmh;
    finalSpeedKmh = state.speedKmh;

    const hardpoints = sim.vehicle.getHardpointsBody();
    for (let i = 0; i < 4; i++) {
      const airborne = state.wheels[i].isAirborne;
      if (step > 0 && airborne !== previousAirborne[i]) airborneToggles[i]++;
      previousAirborne[i] = airborne;

      const hp = hardpoints[i];
      const contactPointBody = { x: hp.x, y: -config.centerOfGravityHeight, z: hp.z };
      const pointVelocity = sim.vehicle.rigidBody.getPointVelocityBody(contactPointBody);
      const steer = state.wheels[i].steerAngle;
      const wheelLongitudinalSpeed = pointVelocity.x * Math.sin(steer) + pointVelocity.z * Math.cos(steer);
      const boundarySide = Math.abs(wheelLongitudinalSpeed) < LEGACY_FREE_ROLL_SWITCH_MS ? -1 : 1;
      if (previousBoundarySide[i] !== 0 && boundarySide !== previousBoundarySide[i]) {
        legacyBoundaryCrossings[i]++;
      }
      previousBoundarySide[i] = boundarySide;

      const fx = state.wheels[i].forceVectorLong;
      const forceSign = Math.abs(fx) > 80 ? Math.sign(fx) : 0;
      if (forceSign !== 0 && previousLongForceSign[i] !== 0 && forceSign !== previousLongForceSign[i]) {
        longitudinalForceSignFlips[i]++;
      }
      if (forceSign !== 0) previousLongForceSign[i] = forceSign;
    }

    if (step < transientWindowSteps) continue;

    heaveMin = Math.min(heaveMin, state.heave);
    heaveMax = Math.max(heaveMax, state.heave);
    rollMin = Math.min(rollMin, state.roll);
    rollMax = Math.max(rollMax, state.roll);
    rollRatePeakDegS = Math.max(rollRatePeakDegS, Math.abs(state.rollRate) * DEG);
    verticalGMin = Math.min(verticalGMin, state.verticalG);
    verticalGMax = Math.max(verticalGMax, state.verticalG);

    const heaveVelocitySign = Math.abs(state.vy) > 0.006 ? Math.sign(state.vy) : 0;
    if (heaveVelocitySign !== 0 && previousHeaveVelocitySign !== 0 && heaveVelocitySign !== previousHeaveVelocitySign) {
      heaveVelocityReversals++;
    }
    if (heaveVelocitySign !== 0) previousHeaveVelocitySign = heaveVelocitySign;

    for (let i = 0; i < 4; i++) {
      const wheel = state.wheels[i];
      travelMin[i] = Math.min(travelMin[i], wheel.verticalTravelM);
      travelMax[i] = Math.max(travelMax[i], wheel.verticalTravelM);
      loadMin[i] = Math.min(loadMin[i], wheel.forceVectorNorm);
      loadMax[i] = Math.max(loadMax[i], wheel.forceVectorNorm);
      damperVelocityPeak[i] = Math.max(damperVelocityPeak[i], Math.abs(wheel.damperVelocity));
    }

    if (step < steadyWindowStart) continue;

    steadyHeaveMin = Math.min(steadyHeaveMin, state.heave);
    steadyHeaveMax = Math.max(steadyHeaveMax, state.heave);
    steadyRollMin = Math.min(steadyRollMin, state.roll);
    steadyRollMax = Math.max(steadyRollMax, state.roll);
    steadyRollRatePeakDegS = Math.max(steadyRollRatePeakDegS, Math.abs(state.rollRate) * DEG);
    const rollRateSign = Math.abs(state.rollRate) > 0.01 ? Math.sign(state.rollRate) : 0;
    if (rollRateSign !== 0 && previousRollRateSign !== 0 && rollRateSign !== previousRollRateSign) {
      steadyRollRateReversals++;
    }
    if (rollRateSign !== 0) previousRollRateSign = rollRateSign;

    for (let i = 0; i < 4; i++) {
      const wheel = state.wheels[i];
      steadyTravelMin[i] = Math.min(steadyTravelMin[i], wheel.verticalTravelM);
      steadyTravelMax[i] = Math.max(steadyTravelMax[i], wheel.verticalTravelM);
      steadyLoadMin[i] = Math.min(steadyLoadMin[i], wheel.forceVectorNorm);
      steadyLoadMax[i] = Math.max(steadyLoadMax[i], wheel.forceVectorNorm);
    }
  }

  return {
    label: '10-kmh-full-lock-neutral',
    entrySpeedKmh,
    finalSpeedKmh,
    heavePeakToPeakMm: (heaveMax - heaveMin) * 1000,
    rollPeakToPeakDeg: (rollMax - rollMin) * DEG,
    rollRatePeakDegS,
    verticalGPeakToPeak: verticalGMax - verticalGMin,
    wheelTravelPeakToPeakMm: travelMax.map((max, i) => (max - travelMin[i]) * 1000),
    tireLoadPeakToPeakN: loadMax.map((max, i) => max - loadMin[i]),
    damperVelocityPeakMps: damperVelocityPeak,
    airborneToggles,
    heaveVelocityReversals,
    steady: {
      heavePeakToPeakMm: (steadyHeaveMax - steadyHeaveMin) * 1000,
      rollPeakToPeakDeg: (steadyRollMax - steadyRollMin) * DEG,
      rollRatePeakDegS: steadyRollRatePeakDegS,
      rollRateReversals: steadyRollRateReversals,
      wheelTravelPeakToPeakMm: steadyTravelMax.map((max, i) => (max - steadyTravelMin[i]) * 1000),
      tireLoadPeakToPeakN: steadyLoadMax.map((max, i) => max - steadyLoadMin[i]),
    },
    legacyBoundaryCrossings,
    longitudinalForceSignFlips,
  };
}

const moderate = runCorner('moderate-raw', () => 0.40, 2.0);
const rawFullDigital = runCorner('raw-full-digital', () => 1.0, 1.2);

let digitalInput = 0;
const heldDigital = runCorner(
  'held-digital-left',
  (sim) => {
    const speedMs = Math.abs(sim.vehicle.rigidBody.getLocalVelocity().z);
    digitalInput = updateDigitalSteeringInput(digitalInput, 1, speedMs, DT, {
      wheelbaseM: config.wheelbase,
      maxSteerAngleRad: config.maxSteerAngle,
      forwardSpeedMs: sim.vehicle.rigidBody.getLocalVelocity().z,
    });
    return digitalInput;
  },
  2.0
);

const tenKmhFullLock = runTenKmhFullLockDiagnostic();

console.log(JSON.stringify({
  scenario: 'M5 low-speed cornering',
  moderate,
  rawFullDigital,
  heldDigital,
  tenKmhFullLock,
}, null, 2));

assert(moderate.peakFrontSlipDeg < 9.0, `moderate corner gross-slid front tires: ${moderate.peakFrontSlipDeg.toFixed(2)} deg`);
assert(moderate.frontSkidSamples === 0, `moderate corner emitted front skid state for ${moderate.frontSkidSamples} samples`);
assert(moderate.meanYawResponseRatio > 0.62, `moderate corner yaw response too low: ${moderate.meanYawResponseRatio.toFixed(3)}`);
assert(moderate.peakRearSlipDeg < 9.0, `moderate corner gross-slid rear tires: ${moderate.peakRearSlipDeg.toFixed(2)} deg`);
assert(
  heldDigital.entryPeakSteerInput > 0.50 && heldDigital.entryPeakSteerInput < 0.95,
  `30 km/h corner entry should be speed-shaped before the car slows into the full-lock crossover, got ${heldDigital.entryPeakSteerInput.toFixed(3)}`
);
assert(
  heldDigital.peakSteerInput > heldDigital.entryPeakSteerInput,
  'digital authority should grow smoothly again as the car slows toward parking/crawl speed'
);
assert(heldDigital.peakFrontSlipDeg < 30, `held full steering became numerically unstable: ${heldDigital.peakFrontSlipDeg.toFixed(2)} deg`);
assert(heldDigital.meanYawResponseRatio > 0.55, `held full steering lost plausible yaw response: ${heldDigital.meanYawResponseRatio.toFixed(3)}`);
assert(heldDigital.finalSpeedKmh > 15, `held full steering scrubbed implausibly much speed: ${heldDigital.finalSpeedKmh.toFixed(1)} km/h`);

// Permanent regression for the reported ~10 km/h full-lock "jelly" shake. The
// initial ~0.75 s body-set transient is intentionally allowed; these limits apply
// to the late steady portion where a real car should no longer keep pumping its
// suspension. They are derived from the fixed deterministic M5 trace with margin.
const maxSteadyTravelMm = Math.max(...tenKmhFullLock.steady.wheelTravelPeakToPeakMm);
const maxSteadyLoadSwingN = Math.max(...tenKmhFullLock.steady.tireLoadPeakToPeakN);
const totalLongitudinalForceFlips = tenKmhFullLock.longitudinalForceSignFlips.reduce((sum, count) => sum + count, 0);
assert(tenKmhFullLock.airborneToggles.every((count) => count === 0),
  `10 km/h full lock toggled wheel contact: ${tenKmhFullLock.airborneToggles.join(',')}`);
assert(tenKmhFullLock.steady.rollPeakToPeakDeg < 0.30,
  `10 km/h full lock kept rocking the body: ${tenKmhFullLock.steady.rollPeakToPeakDeg.toFixed(3)} deg p2p`);
assert(maxSteadyTravelMm < 3.5,
  `10 km/h full lock kept pumping suspension travel: ${maxSteadyTravelMm.toFixed(2)} mm p2p`);
assert(maxSteadyLoadSwingN < 500,
  `10 km/h full lock kept pumping tire load: ${maxSteadyLoadSwingN.toFixed(0)} N p2p`);
assert(Math.max(...tenKmhFullLock.longitudinalForceSignFlips) <= 5 && totalLongitudinalForceFlips <= 8,
  `10 km/h full lock longitudinal force chatter returned: ${tenKmhFullLock.longitudinalForceSignFlips.join(',')}`);

console.log('LowSpeedCorneringTests: PASS');

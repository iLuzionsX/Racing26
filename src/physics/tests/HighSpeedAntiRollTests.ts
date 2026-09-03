import assert from 'node:assert/strict';
import type { ControlInputs, VehicleConfig } from '../../types';
import { Simulation } from '../Simulation';
import { ProvingGroundSurfaceProvider } from '../SurfaceProvider';
import { DEFAULT_VEHICLE_CONFIG } from '../vehiclePresets';
import { BMW_M5_2025_OVERRIDES } from '../m5G90';

const DT = 1 / 120;
const START_SPEED_MS = 200 / 3.6;

const zeroInputs: ControlInputs = {
  throttle: 0,
  brake: 0,
  steer: 0,
  handbrake: false,
  shiftUp: false,
  shiftDown: false,
};

function makeM5(overrides: Partial<VehicleConfig> = {}) {
  const config = {
    ...DEFAULT_VEHICLE_CONFIG,
    ...BMW_M5_2025_OVERRIDES,
    ...overrides,
  } as VehicleConfig;

  const sim = new Simulation(config, new ProvingGroundSurfaceProvider());
  sim.reset(0, 0, 0);
  sim.vehicle.powertrain.isAutomatic = false;
  sim.vehicle.powertrain.gear = 0;
  sim.vehicle.rigidBody.velocity.z = START_SPEED_MS;
  for (const wheel of sim.vehicle.wheels) {
    wheel.angularVelocity = START_SPEED_MS / config.wheelRadius;
  }

  // Give the tire/suspension states time to initialize at speed before steering.
  for (let i = 0; i < 60; i++) sim.stepExplicit(zeroInputs, 1);
  return { sim, config };
}

function laneChangeSteer(time: number, amplitude: number) {
  // Smooth left/right pulse. At 200 km/h, amplitude 0.04 produces roughly half-g,
  // 0.075 reaches the upper three-quarter-g range, and 0.10 pushes close to the
  // calibrated road-tire lateral limit without using an impossible full-lock input.
  const pulseDuration = 0.72;
  if (time < pulseDuration) {
    return amplitude * Math.sin(Math.PI * time / pulseDuration);
  }
  if (time < pulseDuration * 2) {
    const local = time - pulseDuration;
    return -amplitude * Math.sin(Math.PI * local / pulseDuration);
  }
  return 0;
}

function runHighSpeedLaneChange(
  steerAmplitude: number,
  overrides: Partial<VehicleConfig> = {}
) {
  const { sim, config } = makeM5({ antiRollCrossCoupling: 0, ...overrides });
  const startY = sim.vehicle.rigidBody.position.y;

  let peakRollDeg = 0;
  let peakRollRateDegPerSec = 0;
  let peakLatG = 0;
  let peakVerticalG = 0;
  let peakActualSteerDeg = 0;
  let peakBodyRiseM = 0;
  let peakBodyDropM = 0;
  let peakTotalNormalLoadN = 0;
  let minimumTotalNormalLoadN = Number.POSITIVE_INFINITY;
  let minimumWheelLoadN = Number.POSITIVE_INFINITY;
  let minimumInsideSideLoadN = Number.POSITIVE_INFINITY;
  let peakSideLoadDifferenceN = 0;
  let peakArbForceN = 0;
  let peakArbNetBiasN = 0;
  let airborneSamples = 0;

  for (let step = 0; step < 120 * 3.0; step++) {
    const t = step * DT;
    const inputs: ControlInputs = { ...zeroInputs, steer: laneChangeSteer(t, steerAmplitude) };
    const state = sim.stepExplicit(inputs, 1);
    const euler = sim.vehicle.rigidBody.getEuler();
    const localAngularVelocity = sim.vehicle.rigidBody.getLocalAngularVelocity();
    const susp = sim.vehicle.suspension.states;
    const loads = susp.map((corner) => corner.tireNormalForceN);
    const totalNormalLoad = loads.reduce((sum, load) => sum + load, 0);
    const leftLoad = loads[0] + loads[2];
    const rightLoad = loads[1] + loads[3];

    peakRollDeg = Math.max(peakRollDeg, Math.abs(euler.roll) * 180 / Math.PI);
    peakRollRateDegPerSec = Math.max(
      peakRollRateDegPerSec,
      Math.abs(localAngularVelocity.z) * 180 / Math.PI
    );
    peakLatG = Math.max(peakLatG, Math.abs(state.lateralG));
    peakVerticalG = Math.max(peakVerticalG, Math.abs(state.verticalG));
    peakActualSteerDeg = Math.max(peakActualSteerDeg, Math.abs(state.actualSteerAngle) * 180 / Math.PI);
    peakBodyRiseM = Math.max(peakBodyRiseM, sim.vehicle.rigidBody.position.y - startY);
    peakBodyDropM = Math.max(peakBodyDropM, startY - sim.vehicle.rigidBody.position.y);
    peakTotalNormalLoadN = Math.max(peakTotalNormalLoadN, totalNormalLoad);
    minimumTotalNormalLoadN = Math.min(minimumTotalNormalLoadN, totalNormalLoad);
    minimumWheelLoadN = Math.min(minimumWheelLoadN, ...loads);
    minimumInsideSideLoadN = Math.min(minimumInsideSideLoadN, leftLoad, rightLoad);
    peakSideLoadDifferenceN = Math.max(peakSideLoadDifferenceN, Math.abs(rightLoad - leftLoad));
    peakArbForceN = Math.max(
      peakArbForceN,
      ...susp.map((corner) => Math.abs(corner.antiRollBarForceN))
    );

    const arbNetBias =
      Math.abs(susp[0].antiRollBarForceN + susp[1].antiRollBarForceN) +
      Math.abs(susp[2].antiRollBarForceN + susp[3].antiRollBarForceN);
    peakArbNetBiasN = Math.max(peakArbNetBiasN, arbNetBias);

    if (susp.some((corner) => corner.isAirborne)) airborneSamples++;

    assert(Number.isFinite(state.speedKmh), 'high-speed lane change produced non-finite speed');
    assert(Number.isFinite(euler.roll), 'high-speed lane change produced non-finite roll');
  }

  const final = sim.vehicle.getState();
  const weightN = config.mass * 9.81;
  const geometricSideDifferenceAtPeakLatG =
    (2 * config.mass * 9.81 * peakLatG * config.centerOfGravityHeight) / config.trackWidth;

  return {
    steerAmplitude,
    peakRollDeg,
    peakRollRateDegPerSec,
    peakLatG,
    peakVerticalG,
    peakActualSteerDeg,
    peakBodyRiseM,
    peakBodyDropM,
    peakTotalNormalLoadN,
    minimumTotalNormalLoadN,
    minimumWheelLoadN,
    minimumInsideSideLoadN,
    peakSideLoadDifferenceN,
    geometricSideDifferenceAtPeakLatG,
    loadTransferRatioToRigidGeometry:
      geometricSideDifferenceAtPeakLatG > 1
        ? peakSideLoadDifferenceN / geometricSideDifferenceAtPeakLatG
        : 0,
    peakArbForceN,
    peakArbNetBiasN,
    airborneSamples,
    weightN,
    finalSpeedKmh: final.speedKmh,
    finalRollDeg: Math.abs(final.roll) * 180 / Math.PI,
  };
}

const moderateBars = runHighSpeedLaneChange(0.04);
const moderateNoBars = runHighSpeedLaneChange(0.04, {
  rollStiffnessFront: 0,
  rollStiffnessRear: 0,
});
const nearLimitBars = runHighSpeedLaneChange(0.075);
const nearLimitNoBars = runHighSpeedLaneChange(0.075, {
  rollStiffnessFront: 0,
  rollStiffnessRear: 0,
});
const tireLimitBars = runHighSpeedLaneChange(0.10);

console.log(JSON.stringify({
  scenario: '200 km/h smooth double lane change on flat dry surface',
  moderateBars,
  moderateNoBars,
  nearLimitBars,
  nearLimitNoBars,
  tireLimitBars,
  moderateRollReductionFraction: moderateNoBars.peakRollDeg > 1e-6
    ? 1 - moderateBars.peakRollDeg / moderateNoBars.peakRollDeg
    : 0,
  nearLimitRollReductionFraction: nearLimitNoBars.peakRollDeg > 1e-6
    ? 1 - nearLimitBars.peakRollDeg / nearLimitNoBars.peakRollDeg
    : 0,
}, null, 2));

assert(moderateBars.peakLatG > 0.40, `moderate high-speed maneuver was too mild: ${moderateBars.peakLatG.toFixed(2)} g`);
assert(moderateBars.airborneSamples === 0, 'moderate high-speed lane change lifted a wheel');
assert(moderateBars.peakBodyRiseM < 0.05, `moderate maneuver jacked body ${moderateBars.peakBodyRiseM.toFixed(3)} m`);
assert(moderateBars.peakArbNetBiasN < 1e-6, `ARB created net vertical force: ${moderateBars.peakArbNetBiasN} N`);

assert(nearLimitBars.peakLatG > 0.70, `near-limit maneuver failed to reach meaningful lateral load: ${nearLimitBars.peakLatG.toFixed(2)} g`);
assert(nearLimitBars.peakLatG < 1.35, `near-limit maneuver exceeded plausible road-tire lateral acceleration: ${nearLimitBars.peakLatG.toFixed(2)} g`);
assert(nearLimitBars.peakRollDeg < 5.0, `near-limit body roll is excessive: ${nearLimitBars.peakRollDeg.toFixed(2)} deg`);
assert(nearLimitBars.peakBodyRiseM < 0.06, `near-limit maneuver jacked body ${nearLimitBars.peakBodyRiseM.toFixed(3)} m`);
assert(nearLimitBars.peakBodyDropM < 0.06, `near-limit maneuver dropped body ${nearLimitBars.peakBodyDropM.toFixed(3)} m`);
assert(nearLimitBars.airborneSamples === 0, `near-limit lane change created ${nearLimitBars.airborneSamples} airborne samples`);
assert(nearLimitBars.minimumInsideSideLoadN > 1500, `inside side unloaded implausibly: ${nearLimitBars.minimumInsideSideLoadN.toFixed(0)} N`);
assert(nearLimitBars.loadTransferRatioToRigidGeometry < 1.55, `lateral load transfer is too large for configured CG: ${nearLimitBars.loadTransferRatioToRigidGeometry.toFixed(2)}x geometric`);
assert(nearLimitBars.peakArbNetBiasN < 1e-6, `near-limit ARB created net vertical force: ${nearLimitBars.peakArbNetBiasN} N`);
assert(nearLimitBars.finalSpeedKmh > 130, `lane-change test lost implausible speed: ${nearLimitBars.finalSpeedKmh.toFixed(1)} km/h`);

assert(tireLimitBars.peakLatG > 0.85, `tire-limit maneuver did not reach the intended high-g range: ${tireLimitBars.peakLatG.toFixed(2)} g`);
assert(tireLimitBars.peakLatG < 1.25, `tire-limit maneuver exceeded plausible calibrated grip: ${tireLimitBars.peakLatG.toFixed(2)} g`);
assert(tireLimitBars.peakRollDeg < 3.5, `tire-limit body roll is excessive: ${tireLimitBars.peakRollDeg.toFixed(2)} deg`);
assert(tireLimitBars.airborneSamples === 0, `tire-limit lane change created ${tireLimitBars.airborneSamples} airborne samples`);
assert(tireLimitBars.minimumInsideSideLoadN > 2500, `tire-limit inside side unloaded too far: ${tireLimitBars.minimumInsideSideLoadN.toFixed(0)} N`);
assert(tireLimitBars.loadTransferRatioToRigidGeometry > 0.70, `tire-limit load transfer is too weak: ${tireLimitBars.loadTransferRatioToRigidGeometry.toFixed(2)}x geometric`);
assert(tireLimitBars.loadTransferRatioToRigidGeometry < 1.35, `tire-limit load transfer is excessive: ${tireLimitBars.loadTransferRatioToRigidGeometry.toFixed(2)}x geometric`);
assert(tireLimitBars.peakArbNetBiasN < 1e-6, `tire-limit ARB created net vertical force: ${tireLimitBars.peakArbNetBiasN} N`);

import assert from 'node:assert/strict';
import type { ControlInputs, VehicleConfig } from '../../types';
import { DriverAidsSystem } from '../DriverAids';
import { Simulation } from '../Simulation';
import { ProvingGroundSurfaceProvider } from '../SurfaceProvider';
import { DEFAULT_VEHICLE_CONFIG } from '../vehiclePresets';
import { BMW_M5_2025_OVERRIDES } from '../m5G90';
import { PhysicsMath } from '../math/PhysicsMath';

const DT = 1 / 120;
const ABS_LOW_SPEED_CUTOUT_MS = 1.25;
const M5_CONFIG = { ...DEFAULT_VEHICLE_CONFIG, ...BMW_M5_2025_OVERRIDES } as VehicleConfig;
const NEUTRAL: ControlInputs = {
  throttle: 0,
  brake: 0,
  steer: 0,
  handbrake: false,
  shiftUp: false,
  shiftDown: false,
};

function signWithDeadband(value: number, deadband: number): -1 | 0 | 1 {
  if (value > deadband) return 1;
  if (value < -deadband) return -1;
  return 0;
}

function testAbsPhaseOut() {
  const aids = new DriverAidsSystem({
    absMode: 'FULL',
    tcsMode: 'OFF',
    wheelbase: M5_CONFIG.wheelbase,
    trackWidth: M5_CONFIG.trackWidth,
    ackermannRatio: M5_CONFIG.ackermannRatio,
    maxSteerAngle: M5_CONFIG.maxSteerAngle,
    steerSpeed: M5_CONFIG.steerSpeed,
    steerSpeedReduction: M5_CONFIG.steerSpeedReduction,
  });

  let previousPressure = 1;
  let maxPressureStep = 0;
  let minPressure = 1;
  let finalPressure = 0;
  let activeBelowCutout = 0;

  // Start above full ABS authority and sweep through the complete low-speed
  // handoff to below the final cutout.
  for (let i = 0; i <= 420; i++) {
    const speedMs = 3.5 - (3.0 * i / 420);
    const omega = speedMs / M5_CONFIG.wheelRadius;
    const p = aids.updateABS(
      [-0.22, -0.22, -0.22, -0.22],
      [omega * 0.78, omega * 0.78, omega * 0.78, omega * 0.78],
      speedMs,
      true,
      DT
    )[0];
    maxPressureStep = Math.max(maxPressureStep, Math.abs(p - previousPressure));
    minPressure = Math.min(minPressure, p);
    previousPressure = p;
    finalPressure = p;
    if (speedMs < ABS_LOW_SPEED_CUTOUT_MS && aids.absActive) activeBelowCutout++;
  }

  console.log(`ABS phase-out: min=${minPressure.toFixed(3)} final=${finalPressure.toFixed(3)} maxStep=${maxPressureStep.toFixed(4)} activeBelowCutout=${activeBelowCutout}`);
  assert(minPressure < 0.90, 'ABS never entered meaningful pressure regulation above the handoff');
  assert(finalPressure > 0.995, `ABS did not return to full pressure near rest: ${finalPressure.toFixed(3)}`);
  assert(maxPressureStep < 0.08, `ABS pressure jumped during low-speed phase-out: ${maxPressureStep.toFixed(4)}`);
  assert.equal(activeBelowCutout, 0, 'ABS remained active below the final low-speed cutout');
}

function runAutomaticStop(label: string, brake: number, steer: number) {
  const sim = new Simulation(M5_CONFIG, new ProvingGroundSurfaceProvider());
  sim.reset(0, 0, 0);
  sim.vehicle.powertrain.isAutomatic = true;
  sim.vehicle.powertrain.gear = 0;
  for (let i = 0; i < 240; i++) sim.stepExplicit(NEUTRAL, 1);

  const startSpeedMs = 12 / 3.6;
  sim.vehicle.powertrain.gear = 1;
  sim.vehicle.rigidBody.velocity.x = 0;
  sim.vehicle.rigidBody.velocity.z = startSpeedMs;
  sim.vehicle.wheels.forEach((wheel) => wheel.reset(startSpeedMs));

  const inputs: ControlInputs = { ...NEUTRAL, brake, steer };
  let previousLongSign: -1 | 0 | 1 = 1;
  let longSignFlips = 0;
  const previousWheelSigns: (-1 | 0 | 1)[] = [1, 1, 1, 1];
  const wheelSignFlips = [0, 0, 0, 0];
  let previousOmegas = sim.vehicle.wheels.map((wheel) => wheel.angularVelocity);
  let previousPressures = [...sim.vehicle.brakes.pressureModulators];
  let maxOmegaStep = 0;
  let maxPressureStep = 0;
  let maxReverseSpeedMs = 0;
  let absSamplesBelowCutout = 0;
  let minPressureBelowCutout = 1;
  let maxHeldSpeedLast2s = 0;
  const flipDiagnostics: unknown[] = [];

  for (let step = 0; step < 960; step++) {
    sim.stepExplicit(inputs, 1);
    const localV = sim.vehicle.rigidBody.getLocalVelocity();
    const forward = localV.z;
    const speed = Math.abs(forward);
    const sign = signWithDeadband(forward, 0.03);
    if (previousLongSign !== 0 && sign !== 0 && sign !== previousLongSign) {
      longSignFlips++;

      const hardpoints = sim.vehicle.getHardpointsBody();
      const euler = sim.vehicle.rigidBody.getEuler();
      const state = sim.vehicle.getState();
      const wheelConstraintForwardMs = hardpoints.map((point) =>
        sim.vehicle.rigidBody.getPointVelocityBody(point).z
      );
      const rigidGroundPointForwardMs = hardpoints.map((point) =>
        sim.vehicle.rigidBody.getPointVelocityBody(
          PhysicsMath.vec3(point.x, -M5_CONFIG.centerOfGravityHeight, point.z)
        ).z
      );

      flipDiagnostics.push({
        step,
        timeSec: (step + 1) * DT,
        chassisForwardMs: forward,
        pitchDeg: euler.pitch * 180 / Math.PI,
        pitchRateDegS: sim.vehicle.rigidBody.getLocalAngularVelocity().x * 180 / Math.PI,
        wheelConstraintForwardMs,
        rigidGroundPointForwardMs,
        groundPointMinusConstraintMs: rigidGroundPointForwardMs.map(
          (value, i) => value - wheelConstraintForwardMs[i]
        ),
        wheelOmegaRadS: sim.vehicle.wheels.map((wheel) => wheel.angularVelocity),
        rawSlipRatio: sim.vehicle.wheels.map((wheel) => wheel.rawSlipRatio),
        longitudinalForceN: state.wheels.map((wheel) => wheel.forceVectorLong),
        tireNormalForceN: sim.vehicle.suspension.states.map((susp) => susp.tireNormalForceN),
        chassisSuspensionForceN: sim.vehicle.suspension.states.map((susp) => susp.chassisForceN),
        suspensionVelocityMps: sim.vehicle.suspension.states.map((susp) => susp.velocity),
        hubVelocityWorldY: sim.vehicle.suspension.states.map((susp) => susp.hubVelocityWorldY),
      });
    }
    if (sign !== 0) previousLongSign = sign;
    maxReverseSpeedMs = Math.max(maxReverseSpeedMs, Math.max(0, -forward));

    sim.vehicle.wheels.forEach((wheel, index) => {
      const wheelSign = signWithDeadband(wheel.angularVelocity, 0.08);
      if (previousWheelSigns[index] !== 0 && wheelSign !== 0 && wheelSign !== previousWheelSigns[index]) {
        wheelSignFlips[index]++;
      }
      if (wheelSign !== 0) previousWheelSigns[index] = wheelSign;
      maxOmegaStep = Math.max(maxOmegaStep, Math.abs(wheel.angularVelocity - previousOmegas[index]));
      previousOmegas[index] = wheel.angularVelocity;
    });

    const pressures = sim.vehicle.brakes.pressureModulators;
    for (let i = 0; i < 4; i++) {
      maxPressureStep = Math.max(maxPressureStep, Math.abs(pressures[i] - previousPressures[i]));
      previousPressures[i] = pressures[i];
    }
    if (speed < ABS_LOW_SPEED_CUTOUT_MS) {
      if (sim.vehicle.driverAids.absActive) absSamplesBelowCutout++;
      minPressureBelowCutout = Math.min(minPressureBelowCutout, ...pressures);
    }
    if (step >= 720) maxHeldSpeedLast2s = Math.max(maxHeldSpeedLast2s, speed);
  }

  const finalLocal = sim.vehicle.rigidBody.getLocalVelocity();
  const finalSpeedMs = Math.abs(finalLocal.z);
  const finalSpeedKmh = finalSpeedMs * 3.6;
  const totalWheelSignFlips = wheelSignFlips.reduce((a, b) => a + b, 0);

  console.log(`${label}: final=${finalSpeedKmh.toFixed(3)} km/h reversePeak=${maxReverseSpeedMs.toFixed(4)} m/s longFlips=${longSignFlips} wheelFlips=${totalWheelSignFlips} maxOmegaStep=${maxOmegaStep.toFixed(3)} maxPressureStep=${maxPressureStep.toFixed(4)} minPressureBelowCutout=${minPressureBelowCutout.toFixed(3)} absBelowCutout=${absSamplesBelowCutout} heldLast2s=${maxHeldSpeedLast2s.toFixed(4)} m/s`);
  if (flipDiagnostics.length > 0) {
    console.log(`${label} sign-crossing diagnostics:\n${JSON.stringify(flipDiagnostics, null, 2)}`);
  }

  assert(finalSpeedKmh < 0.25, `${label} did not settle to rest: ${finalSpeedKmh.toFixed(3)} km/h`);
  // One sub-walking-speed zero crossing can occur as the tire's stored longitudinal
  // shear relaxes. The limit-cycle failure is repeated forward/reverse crossings or
  // wheel reversals. Keep the one-shot rebound bounded below 0.15 m/s (~0.54 km/h).
  assert(maxReverseSpeedMs < 0.15, `${label} rebounded excessively while braking: ${maxReverseSpeedMs.toFixed(4)} m/s`);
  assert(longSignFlips <= 1, `${label} chassis entered a forward/reverse limit cycle: ${longSignFlips} flips`);
  assert(totalWheelSignFlips <= 2, `${label} wheels entered a rotational sign-flip cycle: ${totalWheelSignFlips} flips`);
  assert(minPressureBelowCutout > 0.99, `${label} ABS kept releasing brake pressure below cutout: ${minPressureBelowCutout.toFixed(3)}`);
  assert.equal(absSamplesBelowCutout, 0, `${label} ABS stayed active below cutout for ${absSamplesBelowCutout} samples`);
  assert(maxHeldSpeedLast2s < 0.10, `${label} did not remain settled during the final two seconds: ${maxHeldSpeedLast2s.toFixed(4)} m/s`);
}

testAbsPhaseOut();
runAutomaticStop('straight moderate brake', 0.35, 0);
runAutomaticStop('straight hard brake', 1.0, 0);
runAutomaticStop('low-speed brake while steering', 0.55, 0.7);
console.log('LowSpeedBrakeLimitCycleTests: PASS');
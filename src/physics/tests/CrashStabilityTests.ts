import { Simulation } from '../Simulation';
import { DEFAULT_VEHICLE_CONFIG } from '../vehiclePresets';
import { BMW_M5_2025_OVERRIDES } from '../m5G90';
import { PhysicsMath } from '../math/PhysicsMath';
import { probeChassisContact } from '../CrashStability';

const assert = (condition: boolean, message: string) => {
  if (!condition) throw new Error(message);
};

const config = {
  ...DEFAULT_VEHICLE_CONFIG,
  ...BMW_M5_2025_OVERRIDES,
} as any;

const neutral = {
  throttle: 0,
  brake: 0,
  steer: 0,
  handbrake: false,
  shiftUp: false,
  shiftDown: false,
};

const finiteVehicle = (sim: Simulation) => {
  const body = sim.vehicle.rigidBody;
  return [
    body.position.x, body.position.y, body.position.z,
    body.velocity.x, body.velocity.y, body.velocity.z,
    body.angularVelocity.x, body.angularVelocity.y, body.angularVelocity.z,
    body.orientation.x, body.orientation.y, body.orientation.z, body.orientation.w,
    ...sim.vehicle.suspension.states.flatMap((state) => [
      state.displacement,
      state.hubPositionWorldY,
      state.hubVelocityWorldY,
      state.tireNormalForceN,
      state.chassisForceN,
    ]),
  ].every(Number.isFinite);
};

// ---------------------------------------------------------------------------
// High-energy UPRIGHT spin recovery. It contains yaw and large lateral slip but no
// artificial roll/pitch tumble. After the energetic phase we remove only remaining
// whole-car/wheel momentum while preserving all tire brush + suspension states. If
// those stored states are unstable they will restart the shake on their own.
// ---------------------------------------------------------------------------
const spinSim = new Simulation(config);
spinSim.reset(0, 0, 0);
for (let i = 0; i < 360; i++) spinSim.stepExplicit(neutral, 1);

const settledSpinHeave = spinSim.vehicle.getState().heave;
spinSim.vehicle.rigidBody.velocity = PhysicsMath.vec3(13, 0, 29);
spinSim.vehicle.rigidBody.angularVelocity = PhysicsMath.vec3(0, 4.2, 0);
spinSim.vehicle.rigidBody.orientation = PhysicsMath.quatFromEuler(
  1.0 * Math.PI / 180,
  0,
  2.0 * Math.PI / 180
);
spinSim.vehicle.wheels.forEach((wheel) => wheel.reset(29));

let maxSpinAngularSpeed = 0;
let maxSpinHeaveDeltaM = 0;
let maxSpinVerticalSpeedMps = 0;
let maxSpinTipDeg = 0;
let spinNonFinite = 0;
let lateShakeEnergy = 0;
let lateSkidFrames = 0;
let latePeakVerticalSpeedMps = 0;

for (let i = 0; i < 1080; i++) {
  if (i === 600) {
    spinSim.vehicle.rigidBody.velocity = PhysicsMath.vec3(0, 0, 0);
    spinSim.vehicle.rigidBody.angularVelocity = PhysicsMath.vec3(0, 0, 0);
    spinSim.vehicle.wheels.forEach((wheel) => {
      wheel.angularVelocity = 0;
    });
  }

  const state = spinSim.stepExplicit(neutral, 1);
  const angularSpeed = PhysicsMath.vec3Length(spinSim.vehicle.rigidBody.angularVelocity);
  const euler = spinSim.vehicle.rigidBody.getEuler();
  const tipDeg = Math.max(Math.abs(euler.pitch), Math.abs(euler.roll)) * 180 / Math.PI;
  maxSpinAngularSpeed = Math.max(maxSpinAngularSpeed, angularSpeed);
  maxSpinTipDeg = Math.max(maxSpinTipDeg, tipDeg);
  maxSpinHeaveDeltaM = Math.max(maxSpinHeaveDeltaM, Math.abs(state.heave - settledSpinHeave));
  maxSpinVerticalSpeedMps = Math.max(maxSpinVerticalSpeedMps, Math.abs(spinSim.vehicle.rigidBody.velocity.y));
  if (!finiteVehicle(spinSim)) spinNonFinite++;

  for (const wheel of state.wheels) {
    assert(wheel.verticalTravelM <= 0.140001, `spin exceeded bump travel: ${wheel.verticalTravelM}`);
    assert(wheel.verticalTravelM >= -0.120001, `spin exceeded droop travel: ${wheel.verticalTravelM}`);
  }

  if (i >= 840) {
    const verticalSpeed = Math.abs(spinSim.vehicle.rigidBody.velocity.y);
    latePeakVerticalSpeedMps = Math.max(latePeakVerticalSpeedMps, verticalSpeed);
    lateShakeEnergy +=
      Math.abs(state.rollRate) +
      Math.abs(state.pitchRate) +
      verticalSpeed * 0.5;
    if (state.wheels.some((wheel) => wheel.isSkidding && wheel.skidIntensity > 0.05)) {
      lateSkidFrames++;
    }
  }
}

assert(spinNonFinite === 0, `spin recovery produced ${spinNonFinite} non-finite samples`);
assert(maxSpinAngularSpeed < 12, `spin angular velocity ran away: ${maxSpinAngularSpeed} rad/s`);
assert(maxSpinTipDeg < 35, `upright spin unexpectedly became a rollover: ${maxSpinTipDeg} deg`);
assert(
  maxSpinHeaveDeltaM < 0.30,
  `upright spin injected excessive vertical chassis motion: ${maxSpinHeaveDeltaM} m`
);
assert(
  maxSpinVerticalSpeedMps < 4.0,
  `upright spin injected excessive vertical velocity: ${maxSpinVerticalSpeedMps} m/s`
);
assert(lateSkidFrames === 0, `stored post-spin tire state restarted skid for ${lateSkidFrames} frames`);
assert(
  latePeakVerticalSpeedMps < 0.12,
  `stored post-spin state restarted vertical shake at ${latePeakVerticalSpeedMps} m/s`
);
assert(lateShakeEnergy / 240 < 0.08, `post-spin chassis retained shake energy: ${lateShakeEnergy / 240}`);

// ---------------------------------------------------------------------------
// Wipeout/roll impact: start the already-rotated car clear of the road, then let it
// strike the surface. This tests collision response rather than seeding the solver
// with an artificial half-meter interpenetration at t=0.
// ---------------------------------------------------------------------------
const crashSim = new Simulation(config);
crashSim.reset(0, 0, 0);
for (let i = 0; i < 240; i++) crashSim.stepExplicit(neutral, 1);

crashSim.vehicle.rigidBody.position.y = 2.0;
crashSim.vehicle.rigidBody.orientation = PhysicsMath.quatFromEuler(
  18 * Math.PI / 180,
  0,
  72 * Math.PI / 180
);
crashSim.vehicle.suspension.reset();
assert(
  probeChassisContact(crashSim.vehicle).contactCount === 0,
  'wipeout test must begin with body shell clear of road'
);
crashSim.vehicle.rigidBody.velocity = PhysicsMath.vec3(14, -7.5, 18);
crashSim.vehicle.rigidBody.angularVelocity = PhysicsMath.vec3(3.5, 2.2, 5.4);
crashSim.vehicle.wheels.forEach((wheel) => wheel.reset(22));

let maxPostStepPenetrationM = 0;
let maxCrashAngularSpeed = 0;
let crashNonFinite = 0;
let maxCrashHeaveM = 0;
for (let i = 0; i < 600; i++) {
  const state = crashSim.stepExplicit(neutral, 1);
  const probe = probeChassisContact(crashSim.vehicle);
  maxPostStepPenetrationM = Math.max(maxPostStepPenetrationM, probe.maxPenetrationM);
  maxCrashAngularSpeed = Math.max(
    maxCrashAngularSpeed,
    PhysicsMath.vec3Length(crashSim.vehicle.rigidBody.angularVelocity)
  );
  maxCrashHeaveM = Math.max(maxCrashHeaveM, Math.abs(state.heave));
  if (!finiteVehicle(crashSim)) crashNonFinite++;

  for (const wheel of state.wheels) {
    assert(wheel.verticalTravelM <= 0.140001, `wipeout exceeded bump travel: ${wheel.verticalTravelM}`);
    assert(wheel.verticalTravelM >= -0.120001, `wipeout exceeded droop travel: ${wheel.verticalTravelM}`);
  }
}

assert(crashNonFinite === 0, `wipeout produced ${crashNonFinite} non-finite samples`);
assert(
  maxPostStepPenetrationM < 0.055,
  `body shell penetrated road after crash projection: ${maxPostStepPenetrationM} m`
);
assert(maxCrashAngularSpeed <= 12.01, `wipeout angular speed exceeded crash ceiling: ${maxCrashAngularSpeed}`);

const finalCrashState = crashSim.vehicle.getState();
const finalCrashEuler = crashSim.vehicle.rigidBody.getEuler();
const finalCrashTotalFzN = finalCrashState.wheels.reduce((sum, wheel) => sum + wheel.forceVectorNorm, 0);
const finalCrashAirborneCount = finalCrashState.wheels.filter((wheel) => wheel.isAirborne).length;
const finalCrashTipDeg = Math.max(
  Math.abs(finalCrashEuler.pitch),
  Math.abs(finalCrashEuler.roll)
) * 180 / Math.PI;

console.log(JSON.stringify({
  uprightSpin: {
    maxAngularSpeedRadS: maxSpinAngularSpeed,
    maxTipDeg: maxSpinTipDeg,
    maxHeaveDeltaM: maxSpinHeaveDeltaM,
    maxVerticalSpeedMps: maxSpinVerticalSpeedMps,
    meanLateShakeEnergy: lateShakeEnergy / 240,
    latePeakVerticalSpeedMps,
    lateSkidFrames,
    nonFiniteSamples: spinNonFinite,
  },
  wipeout: {
    maxPostStepPenetrationM,
    maxAngularSpeedRadS: maxCrashAngularSpeed,
    maxHeaveM: maxCrashHeaveM,
    finalHeaveM: finalCrashState.heave,
    finalTipDeg: finalCrashTipDeg,
    finalTotalTireLoadN: finalCrashTotalFzN,
    finalAirborneCount: finalCrashAirborneCount,
    finalX: finalCrashState.x,
    finalZ: finalCrashState.z,
    finalSurfaceFriction: finalCrashState.wheels.map((wheel) => wheel.surfaceFriction),
    finalTireTemperatureC: finalCrashState.wheels.map((wheel) => wheel.temperature),
    finalTireWearPercent: finalCrashState.wheels.map((wheel) => wheel.tireWearPercent),
    nonFiniteSamples: crashNonFinite,
  },
  status: 'passed',
}, null, 2));

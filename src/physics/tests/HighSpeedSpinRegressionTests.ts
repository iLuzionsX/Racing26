import assert from 'node:assert/strict';
import type { ControlInputs, VehicleConfig } from '../../types';
import { Simulation } from '../Simulation';
import { ProvingGroundSurfaceProvider } from '../SurfaceProvider';
import { DEFAULT_VEHICLE_CONFIG } from '../vehiclePresets';
import { BMW_M5_2025_OVERRIDES } from '../m5G90';
import { PhysicsMath } from '../math/PhysicsMath';

const DT = 1 / 120;
const DEG = 180 / Math.PI;
const TARGET_LATERAL_G = 0.72;
const SPEEDS_KMH = [100, 130, 160];

const neutral: ControlInputs = {
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

function makeRollingM5(speedMs: number) {
  const sim = new Simulation(config, new ProvingGroundSurfaceProvider());
  sim.reset(0, 0, 0);

  // Settle suspension/tires first, then establish a clean rolling state in neutral
  // so this test isolates chassis/tire/rear-steer behavior from powertrain torque.
  for (let i = 0; i < 240; i++) sim.stepExplicit(neutral, 1);
  sim.vehicle.powertrain.isAutomatic = false;
  (sim.vehicle.powertrain as any).gear = 0;
  sim.vehicle.rigidBody.velocity = PhysicsMath.vec3(0, 0, speedMs);
  for (const wheel of sim.vehicle.wheels) wheel.reset(speedMs);
  for (let i = 0; i < 60; i++) sim.stepExplicit(neutral, 1);
  return sim;
}

function sideslipDeg(sim: Simulation): number {
  const v = sim.vehicle.rigidBody.getLocalVelocity();
  return Math.atan2(v.x, Math.max(0.5, Math.abs(v.z))) * DEG;
}

function usefulSteerInput(speedMs: number): number {
  const targetAccel = TARGET_LATERAL_G * 9.81;
  const centerAngle = Math.atan(
    (config.wheelbase * targetAccel) / Math.max(1, speedMs * speedMs)
  );
  return PhysicsMath.clamp(centerAngle / config.maxSteerAngle, 0.008, 0.12);
}

type ContactKinematicProbe = {
  maxProductionErrorMs: number;
  maxLegacyShortcutErrorMs: number;
  samples: number;
};

/**
 * Intercept the velocity pair Vehicle actually passes into each wheel. At speed,
 * that pair must come from the same physical contact patch used for force
 * application. This directly guards the rolled/pitched chassis lever-arm bug:
 * the historical fixed body-space shortcut diverges from the real contact point
 * as load transfer rotates the body.
 */
function installContactKinematicProbe(sim: Simulation): ContactKinematicProbe {
  const probe: ContactKinematicProbe = {
    maxProductionErrorMs: 0,
    maxLegacyShortcutErrorMs: 0,
    samples: 0,
  };
  const hardpoints = sim.vehicle.getHardpointsBody();

  sim.vehicle.wheels.forEach((wheel, index) => {
    const downstreamUpdate = wheel.update.bind(wheel);
    wheel.update = ((
      longitudinalVelocity: number,
      lateralVelocity: number,
      verticalLoad: number,
      camberDeg: number,
      driveTorque: number,
      hydraulicBrakeTorque: number,
      handbrakeTorque: number,
      surfaceFriction: number,
      rollingResistance: number,
      dt: number,
      reflectedDrivelineInertia: number = 0
    ) => {
      const rigid = sim.vehicle.rigidBody;
      const contactWorld = sim.vehicle.suspension.states[index].contactPointWorld;
      const contactArmWorld = PhysicsMath.vec3Sub(contactWorld, rigid.position);
      const actualPointBody = PhysicsMath.quatInverseRotateVec3(
        rigid.orientation,
        contactArmWorld
      );
      const actualVelocityBody = rigid.getPointVelocityBody(actualPointBody);

      const steer = wheel.steerAngle;
      const sinS = Math.sin(steer);
      const cosS = Math.cos(steer);
      const expectedLongitudinal =
        actualVelocityBody.x * sinS + actualVelocityBody.z * cosS;
      const expectedLateral =
        actualVelocityBody.x * cosS - actualVelocityBody.z * sinS;

      probe.maxProductionErrorMs = Math.max(
        probe.maxProductionErrorMs,
        Math.hypot(
          longitudinalVelocity - expectedLongitudinal,
          lateralVelocity - expectedLateral
        )
      );

      const hp = hardpoints[index];
      const legacyPointBody = PhysicsMath.vec3(
        hp.x,
        -config.centerOfGravityHeight,
        hp.z
      );
      const legacyVelocityBody = rigid.getPointVelocityBody(legacyPointBody);
      const legacyLongitudinal =
        legacyVelocityBody.x * sinS + legacyVelocityBody.z * cosS;
      const legacyLateral =
        legacyVelocityBody.x * cosS - legacyVelocityBody.z * sinS;
      probe.maxLegacyShortcutErrorMs = Math.max(
        probe.maxLegacyShortcutErrorMs,
        Math.hypot(
          legacyLongitudinal - expectedLongitudinal,
          legacyLateral - expectedLateral
        )
      );
      probe.samples++;

      return downstreamUpdate(
        longitudinalVelocity,
        lateralVelocity,
        verticalLoad,
        camberDeg,
        driveTorque,
        hydraulicBrakeTorque,
        handbrakeTorque,
        surfaceFriction,
        rollingResistance,
        dt,
        reflectedDrivelineInertia
      );
    }) as typeof wheel.update;
  });

  return probe;
}

function run(speedKmh: number, direction: 1 | -1) {
  const initialSpeedMs = speedKmh / 3.6;
  const sim = makeRollingM5(initialSpeedMs);
  const contactProbe = installContactKinematicProbe(sim);
  const targetSteer = usefulSteerInput(initialSpeedMs) * direction;
  const rampSteps = Math.round(0.35 / DT);
  const holdSteps = Math.round(1.50 / DT);
  const releaseSteps = Math.round(0.75 / DT);

  let peakBetaDeg = 0;
  let peakYawDegS = 0;
  let peakLatG = 0;
  let peakFrontSlipDeg = 0;
  let peakRearSlipDeg = 0;
  let minWheelLoadN = Number.POSITIVE_INFINITY;

  for (let step = 0; step < rampSteps + holdSteps; step++) {
    const ramp = Math.min(1, (step + 1) / rampSteps);
    const state = sim.stepExplicit(
      { ...neutral, steer: targetSteer * ramp },
      1
    );

    peakBetaDeg = Math.max(peakBetaDeg, Math.abs(sideslipDeg(sim)));
    peakYawDegS = Math.max(peakYawDegS, Math.abs(state.yawRate) * DEG);
    peakLatG = Math.max(peakLatG, Math.abs(state.lateralG));
    peakFrontSlipDeg = Math.max(
      peakFrontSlipDeg,
      Math.abs(state.wheels[0].slipAngle) * DEG,
      Math.abs(state.wheels[1].slipAngle) * DEG
    );
    peakRearSlipDeg = Math.max(
      peakRearSlipDeg,
      Math.abs(state.wheels[2].slipAngle) * DEG,
      Math.abs(state.wheels[3].slipAngle) * DEG
    );
    minWheelLoadN = Math.min(
      minWheelLoadN,
      ...state.wheels.map((wheel) => wheel.forceVectorNorm)
    );

    assert(Number.isFinite(state.yawRate), 'high-speed turn produced non-finite yaw');
    assert(Number.isFinite(state.lateralG), 'high-speed turn produced non-finite lateral G');
  }

  let releasePeakYawDegS = 0;
  for (let step = 0; step < releaseSteps; step++) {
    const state = sim.stepExplicit(neutral, 1);
    if (step >= releaseSteps - Math.round(0.20 / DT)) {
      releasePeakYawDegS = Math.max(releasePeakYawDegS, Math.abs(state.yawRate) * DEG);
    }
  }

  return {
    speedKmh,
    direction,
    targetSteer,
    targetRoadWheelDeg: targetSteer * config.maxSteerAngle * DEG,
    peakBetaDeg,
    peakYawDegS,
    peakLatG,
    peakFrontSlipDeg,
    peakRearSlipDeg,
    minWheelLoadN,
    releasePeakYawDegS,
    maxContactKinematicErrorMs: contactProbe.maxProductionErrorMs,
    maxLegacyContactShortcutErrorMs: contactProbe.maxLegacyShortcutErrorMs,
    contactKinematicSamples: contactProbe.samples,
  };
}

function mirrorError(a: number, b: number, floor: number): number {
  return Math.abs(Math.abs(a) - Math.abs(b)) /
    Math.max(floor, (Math.abs(a) + Math.abs(b)) * 0.5);
}

const results = [];
for (const speedKmh of SPEEDS_KMH) {
  const left = run(speedKmh, 1);
  const right = run(speedKmh, -1);
  results.push({ speedKmh, left, right });

  for (const row of [left, right]) {
    assert(row.peakLatG > 0.32,
      `${speedKmh} km/h maneuver was too mild to validate stability: ${row.peakLatG.toFixed(2)}g`);
    assert(row.peakBetaDeg < 6,
      `${speedKmh} km/h turn ran into body sideslip/spin: ${row.peakBetaDeg.toFixed(1)} deg`);
    assert(row.peakYawDegS < 40,
      `${speedKmh} km/h turn developed runaway yaw: ${row.peakYawDegS.toFixed(1)} deg/s`);
    assert(row.peakFrontSlipDeg < 16 && row.peakRearSlipDeg < 16,
      `${speedKmh} km/h turn grossly saturated tires: F=${row.peakFrontSlipDeg.toFixed(1)} R=${row.peakRearSlipDeg.toFixed(1)} deg`);
    assert(row.minWheelLoadN > 100,
      `${speedKmh} km/h turn implausibly unloaded a wheel: ${row.minWheelLoadN.toFixed(0)} N`);
    assert(row.releasePeakYawDegS < 6,
      `${speedKmh} km/h yaw failed to settle after steering release: ${row.releasePeakYawDegS.toFixed(1)} deg/s`);
    assert(row.contactKinematicSamples > 100,
      `${speedKmh} km/h contact kinematic probe did not collect enough samples`);
    assert(row.maxLegacyContactShortcutErrorMs > 0.001,
      `${speedKmh} km/h maneuver did not exercise the rolled/pitched contact-point distinction`);
    assert(row.maxContactKinematicErrorMs < 1e-6,
      `${speedKmh} km/h tire slip velocity was evaluated at a different point than force application: ${row.maxContactKinematicErrorMs.toFixed(6)} m/s`);
  }

  assert(mirrorError(left.peakYawDegS, right.peakYawDegS, 2) < 0.15,
    `${speedKmh} km/h left/right yaw response is not mirrored`);
  assert(mirrorError(left.peakBetaDeg, right.peakBetaDeg, 0.5) < 0.20,
    `${speedKmh} km/h left/right sideslip response is not mirrored`);
  assert(mirrorError(left.peakLatG, right.peakLatG, 0.2) < 0.12,
    `${speedKmh} km/h left/right lateral-G response is not mirrored`);
}

console.log(JSON.stringify({
  scenario: 'M5 realistic high-speed turn stability',
  targetLateralG: TARGET_LATERAL_G,
  results,
}, null, 2));
console.log('HighSpeedSpinRegressionTests: PASS');

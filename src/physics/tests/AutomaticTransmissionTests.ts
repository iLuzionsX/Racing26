import assert from 'node:assert/strict';
import type { ControlInputs, VehicleConfig } from '../../types';
import { VehiclePhysicsEngine } from '../vehiclePhysics';
import { Powertrain, PowertrainConfig } from '../Powertrain';
import { DEFAULT_VEHICLE_CONFIG } from '../vehiclePresets';
import { BMW_M5_2025_OVERRIDES } from '../m5G90';

const DT = 1 / 120;
const M5_CONFIG = { ...DEFAULT_VEHICLE_CONFIG, ...BMW_M5_2025_OVERRIDES } as VehicleConfig;

function makeM5Powertrain(): Powertrain {
  const config: PowertrainConfig = {
    maxTorque: M5_CONFIG.maxTorque,
    idleRpm: M5_CONFIG.idleRpm,
    maxRpm: M5_CONFIG.maxRpm,
    revLimiterRpm: M5_CONFIG.revLimiterRpm,
    flywheelInertia: M5_CONFIG.flywheelInertia,
    engineBrakingTorque: M5_CONFIG.engineBrakingTorque,
    clutchBiteRate: M5_CONFIG.clutchBiteRate,
    maxClutchTorque: M5_CONFIG.maxClutchTorque,
    transmissionEfficiency: M5_CONFIG.transmissionEfficiency,
    turboBoostMaxPsi: M5_CONFIG.turboBoostMaxPsi,
    turboSpoolRate: M5_CONFIG.turboSpoolRate,
    wastegatePressurePsi: M5_CONFIG.wastegatePressurePsi,
    reverseRatio: M5_CONFIG.reverseRatio,
    forwardGearRatios: M5_CONFIG.forwardGearRatios,
    gearRatios: M5_CONFIG.gearRatios,
    finalDriveRatio: M5_CONFIG.finalDriveRatio,
    launchControlEnabled: M5_CONFIG.launchControlEnabled,
    launchControlRpm: (M5_CONFIG as any).launchControlRpm,
    lowSpeedTorqueFillNm: (M5_CONFIG as any).lowSpeedTorqueFillNm,
    torqueFillFadeRpm: (M5_CONFIG as any).torqueFillFadeRpm,
    automaticTorqueConverter: (M5_CONFIG as any).automaticTorqueConverter,
    shiftDurationSec: (M5_CONFIG as any).shiftDurationSec,
    shiftTorqueMultiplier: (M5_CONFIG as any).shiftTorqueMultiplier,
    autoBlipDownshift: M5_CONFIG.autoBlipDownshift,
  };
  return new Powertrain(config);
}

function axleOmegaForLockedRpm(powertrain: Powertrain, gear: number, rpm: number): number {
  const totalRatio = Math.abs(powertrain.getGearRatio(gear) * powertrain.finalDriveRatio);
  return (rpm * Math.PI) / (30 * totalRatio);
}

function testStateToggleWritesThroughToPowertrain() {
  const engine = new VehiclePhysicsEngine(M5_CONFIG);
  assert.equal(engine.state.isAutomatic, false, 'fresh engine should begin in manual mode on desktop');

  const uiSnapshot = engine.state;
  uiSnapshot.isAutomatic = true;

  assert.equal(
    engine.simulation.vehicle.powertrain.isAutomatic,
    true,
    'mutating the UI state automatic flag must update the real powertrain'
  );
  assert.equal(engine.state.isAutomatic, true, 'automatic mode must persist on the next telemetry snapshot');

  uiSnapshot.isAutomatic = false;
  assert.equal(engine.state.isAutomatic, false, 'automatic mode must also switch back off through the UI state');
}

function testManualModeDoesNotSelfShift() {
  const powertrain = makeM5Powertrain();
  powertrain.isAutomatic = false;
  powertrain.gear = 1;
  powertrain.engineRpm = 7000;
  powertrain.flywheelRpm = 7000;

  powertrain.update(1, 0, DT);
  assert.equal(powertrain.gear, 1, 'manual mode must not schedule an automatic upshift');
}

function testAutomaticModeUpshiftsNearFullLoadRedline() {
  const powertrain = makeM5Powertrain();
  powertrain.isAutomatic = true;
  powertrain.gear = 1;
  powertrain.engineRpm = 6900;
  powertrain.flywheelRpm = 6900;

  const axleOmega = axleOmegaForLockedRpm(powertrain, 1, 6800);
  powertrain.update(1, axleOmega, DT);

  assert.equal(powertrain.gear, 2, 'automatic mode should upshift before touching the rev limiter');
}

function testAutomaticKickdownUsesSafeLowerGear() {
  const powertrain = makeM5Powertrain();
  powertrain.isAutomatic = true;
  powertrain.gear = 4;
  powertrain.engineRpm = 1800;
  powertrain.flywheelRpm = 1800;

  const safeAxleOmega = axleOmegaForLockedRpm(powertrain, 3, 3000);
  powertrain.update(1, safeAxleOmega, DT);
  assert.equal(powertrain.gear, 3, 'full-throttle low-RPM operation should kick down when the lower gear is safe');
}

function testAutomaticKickdownRejectsOverRev() {
  const powertrain = makeM5Powertrain();
  powertrain.isAutomatic = true;
  powertrain.gear = 4;
  powertrain.engineRpm = 1800;
  powertrain.flywheelRpm = 1800;

  const unsafeAxleOmega = axleOmegaForLockedRpm(powertrain, 3, 7000);
  powertrain.update(1, unsafeAxleOmega, DT);
  assert.equal(powertrain.gear, 4, 'automatic mode must not downshift into a predicted over-rev');
}

function testAutomaticCoastDownshiftDoesNotInjectThrottle() {
  const powertrain = makeM5Powertrain();
  powertrain.isAutomatic = true;
  powertrain.gear = 3;
  powertrain.engineRpm = M5_CONFIG.idleRpm + 250;
  powertrain.flywheelRpm = powertrain.engineRpm;

  const axleOmega = axleOmegaForLockedRpm(powertrain, 2, 1800);
  const out = powertrain.update(0, axleOmega, DT);

  assert.equal(powertrain.gear, 2, 'closed-throttle automatic coast should downshift when RPM falls below the coast threshold');
  assert(
    out.engineTorque <= 0,
    `automatic coast downshift injected positive engine torque: ${out.engineTorque.toFixed(1)} Nm`
  );
}

function testManualDownshiftStillAutoBlips() {
  const powertrain = makeM5Powertrain();
  powertrain.isAutomatic = false;
  powertrain.gear = 3;
  powertrain.engineRpm = 1800;
  powertrain.flywheelRpm = 1800;

  powertrain.shiftDown();
  const axleOmega = axleOmegaForLockedRpm(powertrain, 2, 1800);
  const out = powertrain.update(0, axleOmega, DT);

  assert.equal(powertrain.gear, 2, 'manual downshift should select the requested lower gear');
  assert(out.engineTorque > 0, 'manual rev-match aid should still blip the engine on a manual downshift');
}

function testAutomaticIdleCreepTorqueIsBounded() {
  const powertrain = makeM5Powertrain();
  powertrain.isAutomatic = true;
  powertrain.gear = 1;
  powertrain.engineRpm = M5_CONFIG.idleRpm;
  powertrain.flywheelRpm = M5_CONFIG.idleRpm;

  const out = powertrain.update(0, 0, DT);

  assert(out.driveshaftTorque > 0, 'automatic in Drive should retain a small amount of idle creep');
  assert(
    out.driveshaftTorque < 500,
    `idle creep is strong enough to self-propel against normal braking: ${out.driveshaftTorque.toFixed(1)} Nm driveshaft torque`
  );
}

function testM5FullThrottleDriveActuallyChangesGear() {
  const engine = new VehiclePhysicsEngine(M5_CONFIG);
  engine.state.isAutomatic = true;

  const inputs: ControlInputs = {
    throttle: 1,
    brake: 0,
    steer: 0,
    handbrake: false,
    shiftUp: false,
    shiftDown: false,
  };

  let maxGear = 1;
  let maxRpm = 0;
  let maxSpeedKmh = 0;
  let shiftCount = 0;
  let previousGear = 1;

  for (let i = 0; i < 1200; i++) {
    const state = engine.update(DT, inputs);
    maxGear = Math.max(maxGear, state.gear);
    maxRpm = Math.max(maxRpm, state.rpm);
    maxSpeedKmh = Math.max(maxSpeedKmh, state.speedKmh);

    assert(state.gear >= 1, `automatic drive entered invalid forward gear ${state.gear}`);
    assert(state.gear <= M5_CONFIG.forwardGearRatios.length, `automatic drive exceeded top gear: ${state.gear}`);
    assert(state.rpm <= M5_CONFIG.maxRpm + 1, `engine exceeded configured maximum RPM: ${state.rpm}`);

    if (state.gear !== previousGear) {
      shiftCount++;
      previousGear = state.gear;
    }
  }

  console.log(
    `  automatic M5 drive: maxGear=${maxGear}, shifts=${shiftCount}, maxRPM=${maxRpm.toFixed(0)}, maxSpeed=${maxSpeedKmh.toFixed(1)} km/h`
  );

  assert(maxSpeedKmh > 30, `automatic M5 failed to accelerate meaningfully: ${maxSpeedKmh.toFixed(1)} km/h`);
  assert(maxGear >= 2, 'automatic M5 never shifted out of first gear during a 10-second full-throttle run');
  assert(shiftCount >= 1, 'automatic M5 produced no observable gear changes');
}

function main() {
  const tests: Array<[string, () => void]> = [
    ['UI automatic flag writes through to the real powertrain', testStateToggleWritesThroughToPowertrain],
    ['manual mode does not self-shift', testManualModeDoesNotSelfShift],
    ['automatic mode upshifts near full-load redline', testAutomaticModeUpshiftsNearFullLoadRedline],
    ['automatic kickdown selects a safe lower gear', testAutomaticKickdownUsesSafeLowerGear],
    ['automatic kickdown blocks predicted over-rev', testAutomaticKickdownRejectsOverRev],
    ['automatic coast downshift does not inject throttle', testAutomaticCoastDownshiftDoesNotInjectThrottle],
    ['manual downshift rev-match aid still blips', testManualDownshiftStillAutoBlips],
    ['automatic idle creep torque stays bounded', testAutomaticIdleCreepTorqueIsBounded],
    ['M5 full-throttle automatic drive changes gear', testM5FullThrottleDriveActuallyChangesGear],
  ];

  for (const [name, test] of tests) {
    test();
    console.log(`PASS ${name}`);
  }

  console.log(`PASS all ${tests.length} automatic-transmission regression tests`);
}

main();
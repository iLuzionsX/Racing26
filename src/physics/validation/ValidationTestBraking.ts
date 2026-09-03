import { writeLineChartSvg } from './ValidationArtifacts';
import {
  DT, MPH_TO_KMH, M_TO_FT, NEUTRAL, basicRow, combineStatuses,
  accelerateTo, makeSim, statusFor, writeTelemetry, type CorrectedValidationResult,
} from './CorrectedValidationCommon';

const WHEEL_PREFIXES = ['fl', 'fr', 'rl', 'rr'] as const;

function runBrakeCase(targetStartKmh: number) {
  const sim = makeSim();
  const acceleratedKmh = accelerateTo(sim, targetStartKmh);

  // accelerateTo() advances in fixed 1/120 s full-throttle steps, so its final
  // sample is necessarily at or slightly above the requested benchmark speed.
  // Instrumented 70–0 and 100–0 tests start at the named speed, not at the first
  // discrete sample above it. Scale chassis and wheel speeds together so the
  // dimensionless tire slip and warmed transient state are preserved while the
  // brake application begins at the exact requested velocity.
  const startSpeedScale = targetStartKmh / Math.max(1e-6, acceleratedKmh);
  sim.vehicle.rigidBody.velocity.x *= startSpeedScale;
  sim.vehicle.rigidBody.velocity.y *= startSpeedScale;
  sim.vehicle.rigidBody.velocity.z *= startSpeedScale;
  sim.vehicle.wheels.forEach((wheel) => {
    wheel.angularVelocity *= startSpeedScale;
  });
  const reachedKmh = (sim.vehicle.getState() as any).speedKmh;

  // The G90 M5 uses an 8-speed automatic. accelerateTo() supplies deterministic
  // upshifts while establishing the requested start speed, but a braking run must
  // hand control back to the actual automatic shift schedule so the gearbox can
  // coast/downshift/unlock as road speed falls. Leaving the externally shifted
  // driveline effectively manual strands the car in a high gear; once turbine
  // speed falls below idle, the generic clutch model can transmit large positive
  // torque into the wheels while the driver is at full brake.
  sim.vehicle.powertrain.isAutomatic = true;

  const rows: Record<string, unknown>[] = [];
  let previous = { ...sim.vehicle.rigidBody.position };
  let distanceM = 0;
  let peakDecelG = 0;
  let absFrames = 0;
  let peakFrontLoadN = 0;
  let minRearLoadN = Number.POSITIVE_INFINITY;
  let peakPitchDeg = 0;
  let stopped = false;
  let minSpeedKmh = reachedKmh;
  let positiveAccelFramesBelow15Kmh = 0;
  let rearPositiveFxFramesBelow15Kmh = 0;
  let peakPositiveDriveshaftTorqueBelow15Kmh = 0;

  for (let i = 0; i < Math.round(8 / DT); i++) {
    const controls = { ...NEUTRAL, brake: 1 };
    const state = sim.stepExplicit(controls as any, 1) as any;
    const position = sim.vehicle.rigidBody.position;
    distanceM += Math.hypot(position.x - previous.x, position.z - previous.z);
    previous = { ...position };

    const row = basicRow(sim, (i + 1) * DT, controls);
    const brakeTorques = sim.vehicle.brakes.calculateBrakeTorques(1, false);
    row.driveshaft_torque_nm = sim.vehicle.powertrain.deliveredDriveshaftTorque;
    row.engine_torque_nm = sim.vehicle.powertrain.engineTorqueOutput;
    row.transmitted_clutch_torque_nm = sim.vehicle.powertrain.transmittedClutchTorque;
    row.converter_slip_rad_s = sim.vehicle.powertrain.converterSlipRadS;
    row.converter_low_load_authority = sim.vehicle.powertrain.converterLowLoadAuthority;

    state.wheels.forEach((wheel: any, wheelIndex: number) => {
      const prefix = WHEEL_PREFIXES[wheelIndex];
      const wheelDynamics = sim.vehicle.wheels[wheelIndex];
      row[`${prefix}_raw_slip_ratio`] = wheelDynamics.rawSlipRatio;
      row[`${prefix}_wheel_surface_speed_ms`] = wheelDynamics.angularVelocity * sim.vehicle.config.wheelRadius;
      row[`${prefix}_abs_pressure`] = sim.vehicle.brakes.pressureModulators[wheelIndex];
      row[`${prefix}_brake_torque_nm`] = brakeTorques.hydraulicTorques[wheelIndex];
      row[`${prefix}_abs_active`] = wheel.absActive ? 1 : 0;
    });
    rows.push(row);

    peakDecelG = Math.max(peakDecelG, Math.max(0, -state.longitudinalG));
    if (state.absActive) absFrames++;
    peakFrontLoadN = Math.max(peakFrontLoadN, state.wheels[0].forceVectorNorm + state.wheels[1].forceVectorNorm);
    minRearLoadN = Math.min(minRearLoadN, state.wheels[2].forceVectorNorm + state.wheels[3].forceVectorNorm);
    peakPitchDeg = Math.max(peakPitchDeg, Math.abs(state.pitch * 180 / Math.PI));
    minSpeedKmh = Math.min(minSpeedKmh, state.speedKmh);

    if (state.speedKmh < 15) {
      peakPositiveDriveshaftTorqueBelow15Kmh = Math.max(
        peakPositiveDriveshaftTorqueBelow15Kmh,
        sim.vehicle.powertrain.deliveredDriveshaftTorque
      );
      if (state.longitudinalG > 0.02) positiveAccelFramesBelow15Kmh++;
      if (state.wheels[2].forceVectorLong + state.wheels[3].forceVectorLong > 500) {
        rearPositiveFxFramesBelow15Kmh++;
      }
    }

    if (state.speedKmh <= 1) {
      stopped = true;
      break;
    }
  }

  const elapsedSec = rows.length * DT;
  const finalSpeedKmh = Number(rows.at(-1)?.speed_kmh ?? reachedKmh);
  return {
    reachedKmh,
    distanceM,
    elapsedSec,
    stopped,
    finalSpeedKmh,
    minSpeedKmh,
    peakDecelG,
    averageDecelMs2: stopped ? (reachedKmh / 3.6) / Math.max(elapsedSec, DT) : null,
    absFraction: absFrames / Math.max(1, rows.length),
    peakFrontLoadN,
    minRearLoadN,
    peakPitchDeg,
    positiveAccelFramesBelow15Kmh,
    rearPositiveFxFramesBelow15Kmh,
    peakPositiveDriveshaftTorqueBelow15Kmh,
    rows,
  };
}

export function runBrakingValidation(artifactDir: string): CorrectedValidationResult {
  const kmh100 = runBrakeCase(100);
  const mph70 = runBrakeCase(70 * MPH_TO_KMH);
  const mph100 = runBrakeCase(100 * MPH_TO_KMH);
  const allStopped = kmh100.stopped && mph70.stopped && mph100.stopped;

  // A run that never reaches <=1 km/h is not a stopping-distance measurement.
  // Never compare its 8-second traveled distance with a real 0-mph reference.
  const feet70 = mph70.stopped ? mph70.distanceM * M_TO_FT : Number.NaN;
  const feet100 = mph100.stopped ? mph100.distanceM * M_TO_FT : Number.NaN;
  const ref70 = statusFor('braking70To0MphFt', feet70);
  const ref100 = statusFor('braking100To0MphFt', feet100);
  const referenceStatus = combineStatuses([ref70.status, ref100.status]);
  const status = allStopped ? referenceStatus : 'FAIL';

  // Keep the canonical 100 km/h trace and retain both external-reference runs so
  // the brake result can be audited wheel-by-wheel instead of inferred from one stop.
  const telemetryFile = writeTelemetry(artifactDir, 'braking', kmh100.rows);
  writeTelemetry(artifactDir, 'braking-70mph', mph70.rows);
  writeTelemetry(artifactDir, 'braking-100mph', mph100.rows);

  const graph = `${artifactDir}/braking-100kmh.svg`;
  writeLineChartSvg(graph, {
    title: '100–0 km/h braking — warmed driveline start',
    subtitle: 'A valid stopping distance exists only if the vehicle reaches ≤1 km/h',
    xLabel: 'time (s)',
    yLabel: 'scaled value',
    x: kmh100.rows.map((row) => Number(row.time_s)),
    series: [
      { name: 'speed km/h', values: kmh100.rows.map((row) => Number(row.speed_kmh)) },
      { name: 'decel g × 50', values: kmh100.rows.map((row) => -Number(row.longitudinal_g) * 50) },
    ],
  });

  const lowSpeedGraph = `${artifactDir}/braking-100kmh-low-speed.svg`;
  const lowSpeedRows = kmh100.rows.filter((row) => Number(row.speed_kmh) <= 20);
  writeLineChartSvg(lowSpeedGraph, {
    title: '100–0 km/h braking — final 20 km/h driveline and wheel behavior',
    subtitle: 'Wheel surface speed and rear tire force verify the automatic driveline does not fight the service brakes',
    xLabel: 'time (s)',
    yLabel: 'km/h or scaled value',
    x: lowSpeedRows.map((row) => Number(row.time_s)),
    series: [
      { name: 'vehicle km/h', values: lowSpeedRows.map((row) => Number(row.speed_kmh)) },
      { name: 'FL surface km/h', values: lowSpeedRows.map((row) => Number(row.fl_wheel_surface_speed_ms) * 3.6) },
      { name: 'FR surface km/h', values: lowSpeedRows.map((row) => Number(row.fr_wheel_surface_speed_ms) * 3.6) },
      { name: 'RL surface km/h', values: lowSpeedRows.map((row) => Number(row.rl_wheel_surface_speed_ms) * 3.6) },
      { name: 'RR surface km/h', values: lowSpeedRows.map((row) => Number(row.rr_wheel_surface_speed_ms) * 3.6) },
      { name: 'rear Fx / 100', values: lowSpeedRows.map((row) => (Number(row.rl_fx_n) + Number(row.rr_fx_n)) / 100) },
      { name: 'driveshaft Nm / 100', values: lowSpeedRows.map((row) => Number(row.driveshaft_torque_nm) / 100) },
    ],
  });

  const summary = allStopped
    ? `100–0 km/h ${kmh100.distanceM.toFixed(2)} m; 70–0 mph ${(feet70).toFixed(1)} ft; 100–0 mph ${(feet100).toFixed(1)} ft.`
    : `FAIL: full brake did not bring the car to rest within 8 s; 100 km/h run ended at ${kmh100.finalSpeedKmh.toFixed(2)} km/h.`;

  return {
    id: 'braking',
    name: 'Braking validation: 100–0 km/h, 70–0 mph and 100–0 mph',
    status,
    validationClass: 'hard',
    blocking: !allStopped,
    summary,
    metrics: {
      braking100To0KmhM: kmh100.stopped ? kmh100.distanceM : null,
      braking100To0KmhSec: kmh100.stopped ? kmh100.elapsedSec : null,
      braking100To0KmhActualStartKmh: kmh100.reachedKmh,
      braking100To0KmhStopped: kmh100.stopped ? 1 : 0,
      braking100To0KmhFinalSpeedKmh: kmh100.finalSpeedKmh,
      braking100To0KmhMinimumSpeedKmh: kmh100.minSpeedKmh,
      braking100To0KmhPeakDecelG: kmh100.peakDecelG,
      braking100To0KmhAverageDecelMs2: kmh100.averageDecelMs2,
      braking70To0MphFt: mph70.stopped ? feet70 : null,
      braking70To0MphActualStartMph: mph70.reachedKmh / MPH_TO_KMH,
      braking70To0MphStopped: mph70.stopped ? 1 : 0,
      braking70To0MphFinalSpeedKmh: mph70.finalSpeedKmh,
      braking100To0MphFt: mph100.stopped ? feet100 : null,
      braking100To0MphActualStartMph: mph100.reachedKmh / MPH_TO_KMH,
      braking100To0MphStopped: mph100.stopped ? 1 : 0,
      braking100To0MphFinalSpeedKmh: mph100.finalSpeedKmh,
      absActiveFraction100Kmh: kmh100.absFraction,
      lowSpeedPositiveAccelerationFrames: kmh100.positiveAccelFramesBelow15Kmh,
      lowSpeedRearPositiveFxFrames: kmh100.rearPositiveFxFramesBelow15Kmh,
      lowSpeedPeakPositiveDriveshaftTorqueNm: kmh100.peakPositiveDriveshaftTorqueBelow15Kmh,
      peakBrakePitchDeg: kmh100.peakPitchDeg,
      frontLoadPeakN: kmh100.peakFrontLoadN,
      rearLoadMinimumN: kmh100.minRearLoadN,
      braking70ErrorPercent: mph70.stopped ? (ref70.errorPercent ?? null) : null,
      braking100MphErrorPercent: mph100.stopped ? (ref100.errorPercent ?? null) : null,
    },
    diagnostics: !allStopped ? [
      'PHYSICS INVARIANT FAILURE: full brake does not bring the vehicle to rest. The run is not a valid stopping-distance measurement.',
      'Inspect per-wheel ABS pressure, brake torque, raw/relaxed slip, wheel surface speed and driveline torque in the retained braking traces before changing any calibration.',
      'Any 70–0 or 100–0 mph distance from an incomplete run is intentionally withheld rather than falsely compared with Car and Driver.',
    ] : referenceStatus === 'FAIL' ? [
      'The car stops with the real automatic shift schedule active, but the completed stopping distances remain outside the external references. Inspect ABS utilization, tire longitudinal force/slip and surface comparability before calibration changes.',
    ] : [
      '100–0 km/h remains descriptive until a directly comparable external G90 reference is found.',
      'The braking phase uses the M5 automatic shift schedule; it no longer leaves the externally upshifted validation driveline stranded in a higher gear as road speed approaches zero.',
      'Each benchmark stop begins at its exact named initial speed instead of the first 120 Hz acceleration sample above that speed.',
      'Per-wheel raw/relaxed slip, wheel surface speed, ABS pressure, hydraulic brake torque, ABS state and powertrain/converter torque are retained for all three braking traces.',
    ],
    reference: ref70.reference,
    telemetryFile,
    graphFiles: [graph, lowSpeedGraph],
  };
}

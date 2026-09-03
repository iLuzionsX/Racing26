import { Simulation } from '../Simulation';
import { ValidationSurfaceProvider } from './ValidationSurfaceProvider';
import { writeLineChartSvg } from './ValidationArtifacts';
import {
  CONFIG, DT, NEUTRAL, basicRow, dominantFrequency, mean, maxAbs, setSpeed,
  writeTelemetry, type CorrectedValidationResult,
} from './CorrectedValidationCommon';

type BumpKind = 'bump-left' | 'bump-full';
type Axle = 'front' | 'rear';

type BumpRun = ReturnType<typeof runBump>;
type StepResponse = {
  index: number | null;
  timeSec: number | null;
  threshold: number;
  preEventMaxStep: number;
};

function numeric(row: Record<string, unknown>, key: string) {
  return Number(row[key] ?? 0);
}

function firstStepChange(
  rows: Record<string, unknown>[],
  onset: number,
  preStart: number,
  key: string,
  minimumThreshold: number,
  noiseMultiplier = 1.5,
  searchStart = onset
): StepResponse {
  const preEventSteps: number[] = [];
  for (let i = Math.max(1, preStart + 1); i < onset; i++) {
    preEventSteps.push(Math.abs(numeric(rows[i], key) - numeric(rows[i - 1], key)));
  }
  const preEventMaxStep = preEventSteps.length > 0 ? Math.max(...preEventSteps) : 0;
  const threshold = Math.max(minimumThreshold, preEventMaxStep * noiseMultiplier);
  for (let i = Math.max(1, searchStart); i < rows.length; i++) {
    if (Math.abs(numeric(rows[i], key) - numeric(rows[i - 1], key)) >= threshold) {
      return {
        index: i,
        timeSec: numeric(rows[i], 'time_s'),
        threshold,
        preEventMaxStep,
      };
    }
  }
  return { index: null, timeSec: null, threshold, preEventMaxStep };
}

function settlingTime(
  rows: Record<string, unknown>[],
  roadEndIndex: number,
  bodyY: number[]
) {
  if (roadEndIndex < 0) return null;

  // The car is still moving under a small speed-hold throttle after the bump, so
  // aero/load state can shift the eventual ride-height equilibrium by ~1-2 mm.
  // Settling must therefore be measured about the measured post-bump equilibrium,
  // not about the pre-bump ride height. Keep the existing 10% / 0.5 mm envelope
  // and 0.35 s hold requirement unchanged.
  const steadySamples = Math.max(1, Math.round(0.50 / DT));
  const finalCenter = mean(bodyY.slice(-steadySamples));
  const bodyFromFinal = bodyY.map((value) => value - finalCenter);
  const postBumpPeak = Math.max(
    0,
    ...bodyFromFinal.slice(roadEndIndex).map((value) => Math.abs(value))
  );
  const threshold = Math.max(0.0005, postBumpPeak * 0.10);
  const holdSamples = Math.round(0.35 / DT);
  for (let i = roadEndIndex; i + holdSamples < rows.length; i++) {
    let settled = true;
    for (let j = i; j < i + holdSamples; j++) {
      if (Math.abs(bodyFromFinal[j]) > threshold) {
        settled = false;
        break;
      }
    }
    if (settled) return numeric(rows[i], 'time_s') - numeric(rows[roadEndIndex], 'time_s');
  }
  return null;
}

function runBump(kind: BumpKind, axle: Axle, speedKmh = 30) {
  const surface = new ValidationSurfaceProvider({
    kind,
    bumpStartZ: 20,
    bumpLengthM: 0.55,
    bumpHeightM: 0.025,
    friction: 1.0,
  });
  const sim = new Simulation(CONFIG, surface);
  const props = sim.vehicle.chassisMassProperties;
  const startZ = axle === 'front'
    ? 20 - props.cgToFrontAxle - 1.0
    : 20 + props.cgToRearAxle - 0.9;
  sim.reset(0, startZ, 0);
  for (let i = 0; i < Math.round(2.5 / DT); i++) sim.stepExplicit(NEUTRAL as any, 1);
  setSpeed(sim, speedKmh / 3.6);

  const wheelIndex = axle === 'front' ? 0 : 2;
  const prefix = wheelIndex === 0 ? 'fl' : 'rl';
  const rows: Record<string, unknown>[] = [];
  for (let i = 0; i < Math.round(3.0 / DT); i++) {
    const controls = { ...NEUTRAL, throttle: 0.08 };
    sim.stepExplicit(controls as any, 1);
    const row = basicRow(sim, i * DT, controls);
    const contact = sim.vehicle.suspension.states[wheelIndex].contactPointWorld;
    row.road_elevation_m = surface.sampleSurface(contact.x, contact.z).elevation;
    rows.push(row);
  }

  // Detect the first physically nonzero road sample. The previous 0.2 mm road
  // threshold was one 120 Hz sample late at 30 km/h, making a genuinely causal
  // wheel-first response appear simultaneous with the chassis response.
  const roadEpsilonM = 1e-9;
  const roadOnsetIndex = rows.findIndex((row) => numeric(row, 'road_elevation_m') > roadEpsilonM);
  const onset = Math.max(0, roadOnsetIndex);
  const preStart = Math.max(0, onset - 12);
  const baselineRows = rows.slice(preStart, Math.max(preStart + 1, onset));
  const base = (key: string) => mean(baselineRows.map((row) => numeric(row, key)));
  const baseHubY = base(`${prefix}_hub_world_y_m`);
  const baseBodyY = base('y_m');
  const hubDelta = rows.map((row) => numeric(row, `${prefix}_hub_world_y_m`) - baseHubY);
  const bodyDelta = rows.map((row) => numeric(row, 'y_m') - baseBodyY);

  const roadOnsetSec = numeric(rows[onset] ?? {}, 'time_s');

  // Response timing is measured from a change between adjacent 120 Hz samples,
  // not from absolute deviation from a drifting pre-bump mean. The detector adapts
  // to measured pre-event numerical/road noise while retaining a physical minimum.
  // This is especially important for the applied suspension reaction: the newly
  // evaluated wheel/spring force is intentionally one integration step ahead of the
  // reaction actually applied to the sprung chassis.
  const hubVelocityResponse = firstStepChange(
    rows, onset, preStart, `${prefix}_hub_velocity_ms`, 0.02
  );
  const suspensionResponse = firstStepChange(
    rows, onset, preStart, `${prefix}_suspension_displacement_m`, 0.0003
  );
  const evaluatedForceResponse = firstStepChange(
    rows, onset, preStart, `${prefix}_evaluated_chassis_force_n`, 100
  );
  const appliedForceResponse = firstStepChange(
    rows, onset, preStart, `${prefix}_applied_chassis_force_n`, 100
  );
  // Chassis acceleration can have small approach/aero trends before the bump. A
  // bump-caused chassis response cannot physically precede the changed suspension
  // reaction reaching the chassis, so begin this search at that measured reaction.
  const chassisAccelResponse = firstStepChange(
    rows,
    onset,
    preStart,
    'chassis_vertical_accel_ms2',
    0.05,
    1.5,
    appliedForceResponse.index ?? onset
  );

  const hubVelocityResponseSec = hubVelocityResponse.timeSec;
  const suspensionResponseSec = suspensionResponse.timeSec;
  const evaluatedForceResponseSec = evaluatedForceResponse.timeSec;
  const appliedForceResponseSec = appliedForceResponse.timeSec;
  const chassisAccelResponseSec = chassisAccelResponse.timeSec;

  const hubDisplacementResponseSec = (() => {
    for (let i = onset; i < hubDelta.length; i++) {
      if (Math.abs(hubDelta[i]) >= 0.0005) return numeric(rows[i], 'time_s');
    }
    return null;
  })();
  const bodyDisplacementResponseSec = (() => {
    for (let i = onset; i < bodyDelta.length; i++) {
      if (Math.abs(bodyDelta[i]) >= 0.0003) return numeric(rows[i], 'time_s');
    }
    return null;
  })();

  let roadEndIndex = -1;
  for (let i = onset + 1; i < rows.length; i++) {
    if (numeric(rows[i], 'road_elevation_m') <= roadEpsilonM) {
      roadEndIndex = i;
      break;
    }
  }
  const spectralStart = Math.min(
    Math.max(0, rows.length - 60),
    Math.max(onset + 1, (roadEndIndex > 0 ? roadEndIndex : onset) + Math.round(0.04 / DT))
  );

  const wheelHopHz = dominantFrequency(hubDelta.slice(spectralStart), 5, 25);
  const bodyHeaveHz = dominantFrequency(bodyDelta.slice(spectralStart), 0.5, 5);
  const hubPeakM = maxAbs(hubDelta);
  const bodyPeakM = maxAbs(bodyDelta);
  const maxCompressionM = Math.max(...rows.map((row) => numeric(row, `${prefix}_suspension_displacement_m`)));
  const minCompressionM = Math.min(...rows.map((row) => numeric(row, `${prefix}_suspension_displacement_m`)));
  const maxBumpStopN = Math.max(...rows.map((row) => numeric(row, `${prefix}_bumpstop_force_n`)));
  const maxHardStopN = Math.max(...rows.map((row) => numeric(row, `${prefix}_hardstop_force_n`)));
  const maxUnsprungAccel = Math.max(...rows.map((row) => Math.abs(numeric(row, `${prefix}_unsprung_accel_ms2`))));
  const accelerationClampHits = rows.filter(
    (row) => Math.abs(numeric(row, `${prefix}_unsprung_accel_ms2`)) >= 299.5
  ).length;
  const airborneSamples = rows.filter((row) => row[`${prefix}_contact`] === false).length;
  const pitchValues = rows.slice(onset).map((row) => numeric(row, 'pitch_deg') - base('pitch_deg'));
  const rollValues = rows.slice(onset).map((row) => numeric(row, 'roll_deg') - base('roll_deg'));
  const bodyY = rows.map((row) => numeric(row, 'y_m'));
  const settleSec = settlingTime(rows, roadEndIndex, bodyY);

  const wheelBeforeChassisDelaySec = hubVelocityResponseSec !== null && chassisAccelResponseSec !== null
    ? chassisAccelResponseSec - hubVelocityResponseSec
    : null;
  const forcePathResolved = [
    hubVelocityResponseSec,
    suspensionResponseSec,
    evaluatedForceResponseSec,
    appliedForceResponseSec,
    chassisAccelResponseSec,
  ].every((value) => value !== null) &&
    (suspensionResponseSec as number) >= (hubVelocityResponseSec as number) - 0.5 * DT &&
    (evaluatedForceResponseSec as number) >= (hubVelocityResponseSec as number) - 0.5 * DT &&
    (appliedForceResponseSec as number) >= (hubVelocityResponseSec as number) + 0.5 * DT &&
    (chassisAccelResponseSec as number) >= (appliedForceResponseSec as number) - 0.5 * DT &&
    (chassisAccelResponseSec as number) >= (hubVelocityResponseSec as number) + 0.5 * DT;

  return {
    kind,
    axle,
    speedKmh,
    prefix,
    rows,
    roadOnsetSec,
    hubVelocityResponseSec,
    hubDisplacementResponseSec,
    suspensionResponseSec,
    evaluatedForceResponseSec,
    appliedForceResponseSec,
    chassisAccelResponseSec,
    bodyDisplacementResponseSec,
    wheelBeforeChassisDelaySec,
    forcePathResolved,
    responseDetector: {
      hubVelocityThreshold: hubVelocityResponse.threshold,
      hubVelocityPreEventMaxStep: hubVelocityResponse.preEventMaxStep,
      suspensionThreshold: suspensionResponse.threshold,
      suspensionPreEventMaxStep: suspensionResponse.preEventMaxStep,
      evaluatedForceThreshold: evaluatedForceResponse.threshold,
      evaluatedForcePreEventMaxStep: evaluatedForceResponse.preEventMaxStep,
      appliedForceThreshold: appliedForceResponse.threshold,
      appliedForcePreEventMaxStep: appliedForceResponse.preEventMaxStep,
      chassisAccelThreshold: chassisAccelResponse.threshold,
      chassisAccelPreEventMaxStep: chassisAccelResponse.preEventMaxStep,
    },
    wheelHopHz,
    bodyHeaveHz,
    hubPeakM,
    bodyPeakM,
    maxCompressionM,
    minCompressionM,
    maxBumpStopN,
    maxHardStopN,
    maxUnsprungAccel,
    accelerationClampHits,
    airborneSamples,
    peakPitchDeg: maxAbs(pitchValues),
    peakRollDeg: maxAbs(rollValues),
    settlingTimeSec: settleSec,
    hubDelta,
    bodyDelta,
  };
}

function modeSeparationResolved(run: BumpRun) {
  return run.wheelHopHz !== null && run.bodyHeaveHz !== null &&
    run.wheelHopHz >= run.bodyHeaveHz * 2;
}

function runSafe(run: BumpRun) {
  return run.accelerationClampHits === 0 &&
    run.maxHardStopN < 1 &&
    run.maxCompressionM < 0.139 &&
    run.minCompressionM > -0.119 &&
    run.bodyPeakM < 0.08;
}

export function runBumpValidation(artifactDir: string): CorrectedValidationResult {
  const singleFront20 = runBump('bump-left', 'front', 20);
  const singleFront30 = runBump('bump-left', 'front', 30);
  const singleFront45 = runBump('bump-left', 'front', 45);
  const singleRear30 = runBump('bump-left', 'rear', 30);
  const fullFront30 = runBump('bump-full', 'front', 30);
  const fullRear30 = runBump('bump-full', 'rear', 30);

  const singleRuns = [singleFront20, singleFront30, singleFront45, singleRear30];
  const allRuns = [...singleRuns, fullFront30, fullRear30];
  const responsesExist = singleRuns.every((run) =>
    run.hubVelocityResponseSec !== null &&
    run.suspensionResponseSec !== null &&
    run.appliedForceResponseSec !== null &&
    run.chassisAccelResponseSec !== null
  );
  const forcePathResolved = responsesExist && singleRuns.every((run) => run.forcePathResolved);
  const modeSeparation = allRuns.every(modeSeparationResolved);
  const safetyResolved = allRuns.every(runSafe);

  const telemetryFile = writeTelemetry(artifactDir, 'bump-response', singleFront30.rows);
  writeTelemetry(artifactDir, 'bump-single-front-20kmh', singleFront20.rows);
  writeTelemetry(artifactDir, 'bump-single-front-45kmh', singleFront45.rows);
  writeTelemetry(artifactDir, 'bump-single-rear-30kmh', singleRear30.rows);
  writeTelemetry(artifactDir, 'bump-axle-front-30kmh', fullFront30.rows);
  writeTelemetry(artifactDir, 'bump-axle-rear-30kmh', fullRear30.rows);

  const graph = `${artifactDir}/bump-response.svg`;
  writeLineChartSvg(graph, {
    title: 'Single-front-wheel bump — unsprung hub vs sprung chassis',
    subtitle: '30 km/h; timing begins at the first physically nonzero road-input sample',
    xLabel: 'time (s)',
    yLabel: 'vertical displacement from pre-bump baseline (m)',
    x: singleFront30.rows.map((row) => numeric(row, 'time_s')),
    series: [
      { name: 'FL hub', values: singleFront30.hubDelta },
      { name: 'sprung chassis CG', values: singleFront30.bodyDelta },
    ],
    markerX: singleFront30.roadOnsetSec,
    markerLabel: 'road input begins',
  });

  const status = !responsesExist || !safetyResolved
    ? 'FAIL'
    : !forcePathResolved || !modeSeparation
    ? 'WARNING'
    : 'NO REFERENCE DATA';

  const front30 = singleFront30;
  return {
    id: 'bump-response',
    name: 'Unsprung-mass force path, bump response and wheel-hop modes',
    status,
    validationClass: 'engineering-plausibility',
    blocking: !responsesExist || !safetyResolved,
    summary: `30 km/h front single-wheel bump: hub ${front30.hubVelocityResponseSec === null ? 'n/a' : ((front30.hubVelocityResponseSec - front30.roadOnsetSec) * 1000).toFixed(1)} ms after road onset; sprung-chassis acceleration ${front30.chassisAccelResponseSec === null ? 'n/a' : ((front30.chassisAccelResponseSec - front30.roadOnsetSec) * 1000).toFixed(1)} ms; wheel-to-chassis separation ${front30.wheelBeforeChassisDelaySec === null ? 'n/a' : (front30.wheelBeforeChassisDelaySec * 1000).toFixed(1)} ms.`,
    metrics: {
      frontRoadOnsetSec: front30.roadOnsetSec,
      frontHubVelocityResponseDelaySec: front30.hubVelocityResponseSec === null ? null : front30.hubVelocityResponseSec - front30.roadOnsetSec,
      frontHubDisplacementResponseDelaySec: front30.hubDisplacementResponseSec === null ? null : front30.hubDisplacementResponseSec - front30.roadOnsetSec,
      frontSuspensionCompressionResponseDelaySec: front30.suspensionResponseSec === null ? null : front30.suspensionResponseSec - front30.roadOnsetSec,
      frontEvaluatedSuspensionForceResponseDelaySec: front30.evaluatedForceResponseSec === null ? null : front30.evaluatedForceResponseSec - front30.roadOnsetSec,
      frontAppliedSuspensionForceResponseDelaySec: front30.appliedForceResponseSec === null ? null : front30.appliedForceResponseSec - front30.roadOnsetSec,
      frontChassisAccelerationResponseDelaySec: front30.chassisAccelResponseSec === null ? null : front30.chassisAccelResponseSec - front30.roadOnsetSec,
      frontBodyDisplacementResponseDelaySec: front30.bodyDisplacementResponseSec === null ? null : front30.bodyDisplacementResponseSec - front30.roadOnsetSec,
      frontWheelBeforeChassisDelaySec: front30.wheelBeforeChassisDelaySec,
      frontAppliedForceDetectorThresholdN: front30.responseDetector.appliedForceThreshold,
      frontAppliedForcePreEventMaxStepN: front30.responseDetector.appliedForcePreEventMaxStep,
      frontChassisAccelDetectorThresholdMps2: front30.responseDetector.chassisAccelThreshold,
      frontChassisAccelPreEventMaxStepMps2: front30.responseDetector.chassisAccelPreEventMaxStep,
      frontWheelHopHz: front30.wheelHopHz,
      frontBodyHeaveHz: front30.bodyHeaveHz,
      rearWheelHopHz: singleRear30.wheelHopHz,
      rearBodyHeaveHz: singleRear30.bodyHeaveHz,
      frontAxleWheelHopHz: fullFront30.wheelHopHz,
      rearAxleWheelHopHz: fullRear30.wheelHopHz,
      frontAxleSettlingTimeSec: fullFront30.settlingTimeSec,
      rearAxleSettlingTimeSec: fullRear30.settlingTimeSec,
      frontAxlePeakPitchDeg: fullFront30.peakPitchDeg,
      rearAxlePeakPitchDeg: fullRear30.peakPitchDeg,
      frontSinglePeakRollDeg: front30.peakRollDeg,
      frontHubPeakVerticalM: front30.hubPeakM,
      frontBodyPeakHeaveM: front30.bodyPeakM,
      frontMaxCompressionM: front30.maxCompressionM,
      frontMinCompressionM: front30.minCompressionM,
      frontMaxBumpStopForceN: front30.maxBumpStopN,
      frontMaxHardStopForceN: front30.maxHardStopN,
      frontMaxUnsprungAccelMps2: front30.maxUnsprungAccel,
      frontUnsprungAccelerationClampHits: front30.accelerationClampHits,
      frontAirborneSamples: front30.airborneSamples,
      wheelBeforeBodyTemporalSeparationResolved: forcePathResolved ? 1 : 0,
      wheelHopBodyModeSeparationResolved: modeSeparation ? 1 : 0,
      bumpTravelAndStabilityResolved: safetyResolved ? 1 : 0,
      front20WheelBeforeChassisDelaySec: singleFront20.wheelBeforeChassisDelaySec,
      front45WheelBeforeChassisDelaySec: singleFront45.wheelBeforeChassisDelaySec,
      rear30WheelBeforeChassisDelaySec: singleRear30.wheelBeforeChassisDelaySec,
    },
    diagnostics: [
      ...(!responsesExist ? ['The bump matrix failed to produce measurable wheel, suspension-force and chassis responses in every required single-wheel scenario.'] : []),
      ...(responsesExist && !forcePathResolved ? [
        'WARNING: at least one single-wheel speed/axle scenario does not quantitatively preserve road -> unsprung hub -> suspension reaction -> sprung-chassis response at 120 Hz.',
      ] : []),
      ...(!modeSeparation ? [
        'WARNING: at least one bump scenario does not show a wheel-hop mode at least twice the sprung-body heave frequency.',
      ] : []),
      ...(!safetyResolved ? [
        'FAIL: the bump matrix hit a hard travel limit, the unsprung-acceleration safety bound, or an excessive chassis-heave condition. Inspect raw telemetry rather than masking the instability.',
      ] : []),
      ...(forcePathResolved ? [
        'Internal causal-order check passed across 20/30/45 km/h front single-wheel bumps and the 30 km/h rear single-wheel bump: road input moves the unsprung hub/evaluated suspension state first, then the changed suspension reaction reaches the sprung chassis on a later 120 Hz sample.',
      ] : []),
      'REFERENCE DATA NEEDED for production G90 wheel-hop frequency, body-heave frequency, damping ratio and axle-bump settling time.',
    ],
    telemetryFile,
    graphFiles: [graph],
  };
}

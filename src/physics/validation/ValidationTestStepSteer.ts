import { writeLineChartSvg } from './ValidationArtifacts';
import {
  CONFIG, DT, DEG_TO_RAD, NEUTRAL, RAD_TO_DEG, basicRow, makeSim, maxAbs,
  mean, setSpeed, writeTelemetry, type CorrectedValidationResult,
} from './CorrectedValidationCommon';

function firstAtOrAbove(values: number[], threshold: number, times: number[]) {
  const index = values.findIndex((value) => value >= threshold);
  return index >= 0 ? times[index] : null;
}

function runStep(speedKmh: number) {
  const sim = makeSim();
  setSpeed(sim, speedKmh / 3.6);
  const rows: Record<string, unknown>[] = [];
  const steer = (3 * DEG_TO_RAD) / CONFIG.maxSteerAngle;

  for (let i = 0; i < Math.round(3 / DT); i++) {
    const controls = { ...NEUTRAL, steer: i * DT < 1.5 ? steer : 0 };
    sim.stepExplicit(controls as any, 1);
    rows.push(basicRow(sim, i * DT, controls));
  }

  const hold = rows.filter((row) => Number(row.time_s) >= 0.8 && Number(row.time_s) < 1.5);
  const steadyYaw = mean(hold.map((row) => Math.abs(Number(row.yaw_rate_deg_s))));
  const steadySteer = mean(hold.map((row) =>
    Math.abs((Number(row.fl_steer_deg) + Number(row.fr_steer_deg)) * 0.5)
  ));
  const steadySlip = mean(hold.map((row) =>
    0.5 * (Math.abs(Number(row.fl_slip_angle_deg)) + Math.abs(Number(row.fr_slip_angle_deg)))
  ));

  const times = rows.map((row) => Number(row.time_s));
  const steerSeries = rows.map((row) =>
    Math.abs((Number(row.fl_steer_deg) + Number(row.fr_steer_deg)) * 0.5)
  );
  const slipSeries = rows.map((row) =>
    0.5 * (Math.abs(Number(row.fl_slip_angle_deg)) + Math.abs(Number(row.fr_slip_angle_deg)))
  );
  const yawSeries = rows.map((row) => Math.abs(Number(row.yaw_rate_deg_s)));

  const steer10 = firstAtOrAbove(steerSeries, steadySteer * 0.10, times);
  const slip10 = firstAtOrAbove(slipSeries, steadySlip * 0.10, times);
  const yaw10 = firstAtOrAbove(yawSeries, steadyYaw * 0.10, times);
  const yaw90 = firstAtOrAbove(yawSeries, steadyYaw * 0.90, times);
  const peakYaw = Math.max(...rows
    .filter((row) => Number(row.time_s) < 1.5)
    .map((row) => Math.abs(Number(row.yaw_rate_deg_s))));
  const overshoot = steadyYaw > 1e-6 ? (peakYaw / steadyYaw - 1) * 100 : null;

  const releaseRows = rows.filter((row) => Number(row.time_s) >= 1.5);
  const settlingThreshold = steadyYaw * 0.05;
  const window = Math.round(0.2 / DT);
  let settlingTimeSec: number | null = null;
  for (let i = 0; i <= releaseRows.length - window; i++) {
    if (releaseRows.slice(i, i + window).every((row) => Math.abs(Number(row.yaw_rate_deg_s)) <= settlingThreshold)) {
      settlingTimeSec = Number(releaseRows[i].time_s) - 1.5;
      break;
    }
  }

  const yawRateGain = steadySteer > 1e-6 ? steadyYaw / steadySteer : null;
  const chronologyCorrect = steer10 !== null && slip10 !== null && yaw10 !== null &&
    steer10 <= slip10 + DT && yaw10 >= slip10 + 0.5 * DT;

  return {
    speedKmh,
    rows,
    steadyYaw,
    steadySteer,
    steadySlip,
    steer10,
    slip10,
    yaw10,
    yaw90,
    riseTimeSec: yaw10 !== null && yaw90 !== null ? yaw90 - yaw10 : null,
    overshoot,
    settlingTimeSec,
    yawRateGain,
    chronologyCorrect,
  };
}

export function runStepSteerValidation(artifactDir: string): CorrectedValidationResult {
  const runs = [30, 50, 80, 100].map(runStep);
  const run80 = runs.find((run) => run.speedKmh === 80)!;
  const coherent = runs.every((run) =>
    run.chronologyCorrect && (run.overshoot ?? 999) < 120 &&
    maxAbs(run.rows.map((row) => Number(row.roll_deg))) < 12
  );

  const telemetryFile = writeTelemetry(artifactDir, 'step-steer', run80.rows);
  const graph = `${artifactDir}/step-steer-80kmh.svg`;
  writeLineChartSvg(graph, {
    title: '80 km/h step-steer — onset and chassis response',
    subtitle: 'Road-wheel command held 1.5 s then released; first-frame threshold crossings are preserved',
    xLabel: 'time (s)',
    yLabel: 'scaled response',
    markerX: 1.5,
    markerLabel: 'steering release',
    x: run80.rows.map((row) => Number(row.time_s)),
    series: [
      { name: 'yaw deg/s', values: run80.rows.map((row) => Number(row.yaw_rate_deg_s)) },
      { name: 'roll deg × 10', values: run80.rows.map((row) => Number(row.roll_deg) * 10) },
      { name: 'lateral g × 30', values: run80.rows.map((row) => Number(row.lateral_g) * 30) },
    ],
  });

  return {
    id: 'step-steer',
    name: 'Step-steer response and yaw-rate gain',
    status: coherent ? 'NO REFERENCE DATA' : 'FAIL',
    validationClass: 'internal-regression',
    blocking: !coherent,
    summary: `80 km/h yaw onset ${run80.yaw10?.toFixed(3) ?? 'n/a'} s, 10–90 rise ${run80.riseTimeSec?.toFixed(3) ?? 'n/a'} s, overshoot ${run80.overshoot?.toFixed(1) ?? 'n/a'}%.`,
    metrics: Object.fromEntries(runs.flatMap((run) => [
      [`${run.speedKmh}Kmh_steer10Sec`, run.steer10],
      [`${run.speedKmh}Kmh_frontSlip10Sec`, run.slip10],
      [`${run.speedKmh}Kmh_yaw10Sec`, run.yaw10],
      [`${run.speedKmh}Kmh_yawRiseTimeSec`, run.riseTimeSec],
      [`${run.speedKmh}Kmh_yawOvershootPercent`, run.overshoot],
      [`${run.speedKmh}Kmh_settlingTimeSec`, run.settlingTimeSec],
      [`${run.speedKmh}Kmh_yawRateGainDegSPerRoadWheelDeg`, run.yawRateGain],
      [`${run.speedKmh}Kmh_chronologyCorrect`, run.chronologyCorrect ? 1 : 0],
    ])),
    diagnostics: [
      ...(!coherent ? [
        'Steer/slip/yaw chronology is physically incoherent or the response diverged. Inspect steering response, tire relaxation, lateral-force buildup and chassis inertia.',
      ] : []),
      'The PR #27 base does not yet include the separate PR #26 physical steering-rack dynamics, so this test measures road-wheel/tire/chassis response rather than rack inertia.',
      'REFERENCE DATA NEEDED for instrumented G90 step-steer delay, rise time, overshoot and yaw-rate gain.',
    ],
    telemetryFile,
    graphFiles: [graph],
  };
}

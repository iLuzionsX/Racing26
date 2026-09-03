import {
  CONFIG, DT, DEG_TO_RAD, NEUTRAL, basicRow, makeSim, maxAbs, setSpeed,
  totalKineticEnergy, writeTelemetry, type CorrectedValidationResult,
} from './CorrectedValidationCommon';

export function runEnergyValidation(artifactDir: string): CorrectedValidationResult {
  const coast = makeSim();
  setSpeed(coast, 30 / 3.6);
  const initialEnergyJ = totalKineticEnergy(coast);
  let maxEnergyJ = initialEnergyJ;
  const coastRows: Record<string, unknown>[] = [];
  for (let i = 0; i < Math.round(5 / DT); i++) {
    coast.stepExplicit(NEUTRAL as any, 1);
    maxEnergyJ = Math.max(maxEnergyJ, totalKineticEnergy(coast));
    coastRows.push(basicRow(coast, i * DT, NEUTRAL));
  }
  const coastFinalSpeedKmh = Number(coastRows.at(-1)?.speed_kmh ?? 0);

  const turn = makeSim();
  setSpeed(turn, 20 / 3.6);
  const turnRows: Record<string, unknown>[] = [];
  const steer = (12 * DEG_TO_RAD) / CONFIG.maxSteerAngle;
  for (let i = 0; i < Math.round(5 / DT); i++) {
    const controls = { ...NEUTRAL, steer };
    turn.stepExplicit(controls as any, 1);
    turnRows.push(basicRow(turn, i * DT, controls));
  }
  const peakTurnSpeedKmh = Math.max(...turnRows.map((row) => Number(row.speed_kmh)));
  const finalTurnSpeedKmh = Number(turnRows.at(-1)?.speed_kmh ?? 0);

  const rest = makeSim();
  const restRows: Record<string, unknown>[] = [];
  for (let i = 0; i < Math.round(2 / DT); i++) {
    const controls = { ...NEUTRAL, steer };
    rest.stepExplicit(controls as any, 1);
    restRows.push(basicRow(rest, i * DT, controls));
  }
  const maxRestYawRateDegS = maxAbs(restRows.map((row) => Number(row.yaw_rate_deg_s)));
  const maxRestSpeedKmh = Math.max(...restRows.map((row) => Number(row.speed_kmh)));
  const energyGrowthPercent = initialEnergyJ > 0 ? (maxEnergyJ / initialEnergyJ - 1) * 100 : 0;

  const pass = energyGrowthPercent < 0.5 &&
    coastFinalSpeedKmh <= 30.05 &&
    peakTurnSpeedKmh <= 20.6 &&
    finalTurnSpeedKmh <= 20.2 &&
    maxRestYawRateDegS < 0.25 &&
    maxRestSpeedKmh < 0.2;

  const telemetryFile = writeTelemetry(artifactDir, 'energy-sanity', turnRows);
  return {
    id: 'energy-sanity',
    name: 'Energy, coast-down and low-speed turning sanity checks',
    status: pass ? 'PASS' : 'FAIL',
    validationClass: 'internal-regression',
    blocking: !pass,
    summary: `No-throttle 20 km/h turn peak ${peakTurnSpeedKmh.toFixed(2)} km/h; true per-step coast energy growth ${energyGrowthPercent.toFixed(3)}%.`,
    metrics: {
      coastInitialEnergyJ: initialEnergyJ,
      coastMaxEnergyJ: maxEnergyJ,
      coastMaxEnergyGrowthPercent: energyGrowthPercent,
      coastFinalSpeedKmh,
      lowSpeedTurnInitialKmh: 20,
      lowSpeedTurnPeakKmh: peakTurnSpeedKmh,
      lowSpeedTurnFinalKmh: finalTurnSpeedKmh,
      restSteeringPeakYawRateDegS: maxRestYawRateDegS,
      restSteeringPeakSpeedKmh: maxRestSpeedKmh,
    },
    diagnostics: pass ? [] : [
      'Investigate tire-force direction, low-speed tire regularization, drivetrain feedback, rolling resistance and numerical energy injection. Do not hide energy creation with damping.',
    ],
    telemetryFile,
    graphFiles: [],
  };
}

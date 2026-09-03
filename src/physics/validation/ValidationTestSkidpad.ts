import { ValidationSurfaceProvider } from './ValidationSurfaceProvider';
import { writeLineChartSvg, writeRowsCsv } from './ValidationArtifacts';
import {
  CONFIG, DT, G, NEUTRAL, RAD_TO_DEG, autoShift, basicRow, clamp, linearSlope,
  mean, setSpeed, statusFor, wrap, writeTelemetry, type CorrectedValidationResult,
} from './CorrectedValidationCommon';
import { Simulation } from '../Simulation';

type CirclePoint = {
  targetG: number;
  measuredG: number;
  targetSpeedKmh: number;
  measuredSpeedKmh: number;
  measuredRadiusM: number;
  roadSteerDeg: number;
  steeringWheelEstimateDeg: number;
  rollDeg: number;
  sideslipDeg: number;
  loads: number[];
  lateralForces: number[];
  slips: number[];
  stable: boolean;
};

function runCircle(targetG: number, radiusM = 45.72): { point: CirclePoint; rows: Record<string, unknown>[] } {
  const surface = new ValidationSurfaceProvider({ friction: 1.0, rollingResistance: 0.015 });
  const sim = new Simulation(CONFIG, surface);
  sim.reset(-radiusM, 0, 0);
  for (let i = 0; i < Math.round(2.2 / DT); i++) sim.stepExplicit(NEUTRAL as any, 1);

  const targetSpeedMs = Math.sqrt(targetG * G * radiusM);
  setSpeed(sim, targetSpeedMs);
  const kinematicSteer = Math.atan(CONFIG.wheelbase / radiusM);
  const rows: Record<string, unknown>[] = [];

  for (let i = 0; i < Math.round(5.5 / DT); i++) {
    const state = sim.vehicle.getState() as any;
    const x = sim.vehicle.rigidBody.position.x;
    const z = sim.vehicle.rigidBody.position.z;
    const radiusNow = Math.hypot(x, z);
    const desiredYaw = Math.atan2(z, -x);
    const headingError = wrap(desiredYaw - state.yaw);
    const radialError = (radiusNow - radiusM) / radiusM;

    // Scripted driver only. It can command steering/throttle/brake, but never
    // touches vehicle state, tire force or yaw directly.
    const roadSteer = kinematicSteer + 1.35 * headingError + 0.85 * radialError;
    const steer = clamp(roadSteer / CONFIG.maxSteerAngle, -1, 1);
    const speedError = targetSpeedMs - state.speedMs;
    const throttle = clamp(0.16 + speedError * 0.42, 0, 1);
    const brake = clamp(-speedError * 0.22, 0, 0.7);
    const controls = { ...NEUTRAL, steer, throttle, brake };

    sim.stepExplicit(controls as any, 1);
    autoShift(sim);
    rows.push(basicRow(sim, (i + 1) * DT, controls));
  }

  const tail = rows.slice(-Math.round(1.2 / DT));
  const avg = (key: string) => mean(tail.map((row) => Number(row[key])));
  const measuredG = mean(tail.map((row) => Math.abs(Number(row.lateral_g))));
  const measuredSpeedKmh = avg('speed_kmh');
  const measuredSpeedMs = measuredSpeedKmh / 3.6;
  const yawRateRadS = mean(tail.map((row) => Math.abs(Number(row.yaw_rate_deg_s) / RAD_TO_DEG)));
  const measuredRadiusM = yawRateRadS > 1e-6 ? measuredSpeedMs / yawRateRadS : Number.POSITIVE_INFINITY;
  const roadSteerDeg = mean(tail.map((row) =>
    Math.abs((Number(row.fl_steer_deg) + Number(row.fr_steer_deg)) * 0.5)
  ));
  const steeringWheelEstimateDeg = roadSteerDeg * 14.2;
  const rollDeg = mean(tail.map((row) => Math.abs(Number(row.roll_deg))));
  const sideslipDeg = mean(tail.map((row) => Math.abs(Number(row.sideslip_deg))));
  const loads = ['fl', 'fr', 'rl', 'rr'].map((prefix) => avg(`${prefix}_fz_n`));
  const lateralForces = ['fl', 'fr', 'rl', 'rr'].map((prefix) =>
    mean(tail.map((row) => Math.abs(Number(row[`${prefix}_fy_n`]))))
  );
  const slips = ['fl', 'fr', 'rl', 'rr'].map((prefix) =>
    mean(tail.map((row) => Math.abs(Number(row[`${prefix}_slip_angle_deg`]))))
  );

  const radiusError = Math.abs(measuredRadiusM - radiusM) / radiusM;
  const speedErrorFraction = Math.abs(measuredSpeedKmh - targetSpeedMs * 3.6) / (targetSpeedMs * 3.6);
  const stable = radiusError < 0.08 && speedErrorFraction < 0.08 && sideslipDeg < 8;

  return {
    point: {
      targetG,
      measuredG,
      targetSpeedKmh: targetSpeedMs * 3.6,
      measuredSpeedKmh,
      measuredRadiusM,
      roadSteerDeg,
      steeringWheelEstimateDeg,
      rollDeg,
      sideslipDeg,
      loads,
      lateralForces,
      slips,
      stable,
    },
    rows,
  };
}

export function runSkidpadValidation(artifactDir: string): CorrectedValidationResult {
  const targets = [0.10, 0.20, 0.30, 0.40, 0.50, 0.60, 0.70, 0.80, 0.90, 0.98, 1.05];
  const runs = targets.map((target) => runCircle(target));
  const stable = runs.map((run) => run.point).filter((point) => point.stable);
  const peakG = stable.length ? Math.max(...stable.map((point) => point.measuredG)) : 0;
  const reference = statusFor('skidpadPeakG', peakG);
  const gradientPoints = stable.filter((point) => point.measuredG >= 0.18 && point.measuredG <= 0.75);
  const kinematicDeg = Math.atan(CONFIG.wheelbase / 45.72) * RAD_TO_DEG;
  const rollGradient = linearSlope(gradientPoints.map((point) => ({ x: point.measuredG, y: point.rollDeg })));
  const understeerGradient = linearSlope(gradientPoints.map((point) => ({
    x: point.measuredG,
    y: point.roadSteerDeg - kinematicDeg,
  })));
  const steeringWheelSlope = linearSlope(gradientPoints.map((point) => ({
    x: point.measuredG,
    y: point.steeringWheelEstimateDeg,
  })));

  const loadPoint = stable.length
    ? stable.reduce((best, point) =>
        Math.abs(point.measuredG - 0.6) < Math.abs(best.measuredG - 0.6) ? point : best,
      stable[0])
    : runs[0].point;
  const leftLoad = loadPoint.loads[0] + loadPoint.loads[2];
  const rightLoad = loadPoint.loads[1] + loadPoint.loads[3];
  const loadDirectionCorrect = rightLoad > leftLoad;

  const sweepRows = runs.map(({ point }) => ({
    radius_m: 45.72,
    target_lateral_g: point.targetG,
    measured_lateral_g: point.measuredG,
    target_speed_kmh: point.targetSpeedKmh,
    measured_speed_kmh: point.measuredSpeedKmh,
    measured_radius_m: point.measuredRadiusM,
    stable: point.stable,
    road_wheel_steer_deg: point.roadSteerDeg,
    steering_wheel_estimate_deg: point.steeringWheelEstimateDeg,
    roll_deg: point.rollDeg,
    sideslip_deg: point.sideslipDeg,
    fz_fl_n: point.loads[0],
    fz_fr_n: point.loads[1],
    fz_rl_n: point.loads[2],
    fz_rr_n: point.loads[3],
    fy_fl_n: point.lateralForces[0],
    fy_fr_n: point.lateralForces[1],
    fy_rl_n: point.lateralForces[2],
    fy_rr_n: point.lateralForces[3],
    slip_fl_deg: point.slips[0],
    slip_fr_deg: point.slips[1],
    slip_rl_deg: point.slips[2],
    slip_rr_deg: point.slips[3],
  }));
  const sweepFile = `${artifactDir}/skidpad-sweep.csv`;
  writeRowsCsv(sweepFile, sweepRows);

  const representative = runs.reduce((best, run) =>
    Math.abs(run.point.targetG - 0.98) < Math.abs(best.point.targetG - 0.98) ? run : best,
  runs[0]);
  const telemetryFile = writeTelemetry(artifactDir, 'skidpad', representative.rows);
  const graph = `${artifactDir}/skidpad-steering-vs-lateral-g.svg`;
  writeLineChartSvg(graph, {
    title: '45.72 m skidpad — validated speed/radius hold',
    subtitle: 'Only points within ±8% speed and radius and <8° sideslip count toward peak grip',
    xLabel: 'lateral acceleration (g)',
    yLabel: 'angle (deg)',
    x: stable.map((point) => point.measuredG),
    series: [
      { name: 'road-wheel steer', values: stable.map((point) => point.roadSteerDeg) },
      { name: 'body roll', values: stable.map((point) => point.rollDeg) },
    ],
  });

  let status = reference.status;
  if (!stable.length || !loadDirectionCorrect) status = 'FAIL';

  return {
    id: 'skidpad',
    name: 'Constant-radius skidpad, steering demand, understeer and load transfer',
    status,
    validationClass: 'hard',
    blocking: !loadDirectionCorrect,
    summary: stable.length
      ? `45.72 m validated sweep reached ${peakG.toFixed(3)} g; ${stable.length}/${runs.length} points held speed/radius.`
      : 'No fixed-radius point met the speed/radius/sideslip quality gate.',
    metrics: {
      skidpadPeakG: peakG,
      stablePointCount: stable.length,
      requestedPointCount: runs.length,
      rollGradientDegPerG: rollGradient,
      roadWheelUndersteerGradientDegPerG: understeerGradient,
      steeringWheelAngleSlopeDegPerG: steeringWheelSlope,
      loadCheckAtG: loadPoint.measuredG,
      FL_Fz_N: loadPoint.loads[0],
      FR_Fz_N: loadPoint.loads[1],
      RL_Fz_N: loadPoint.loads[2],
      RR_Fz_N: loadPoint.loads[3],
      outsideRightLoadN: rightLoad,
      insideLeftLoadN: leftLoad,
      outsideLoadTransferDirectionCorrect: loadDirectionCorrect ? 1 : 0,
      skidpadReferenceErrorPercent: reference.errorPercent ?? null,
    },
    diagnostics: [
      ...(reference.status === 'FAIL' ? [
        'The quality-gated fixed-radius sweep does not match the 0.98 g Car and Driver anchor. Investigate tire lateral force/load sensitivity, camber, steering geometry and axle load transfer before changing grip.',
      ] : []),
      ...(!stable.length ? ['The scripted driver cannot hold a valid 45.72 m speed/radius point; treat this as a harness/vehicle-control limitation, not a grip claim.'] : []),
      ...(!loadDirectionCorrect ? ['Left-turn lateral load transfer direction is reversed; this is a blocking coordinate/sign defect.'] : []),
      'Steering-wheel angle remains an explicitly labeled 14.2:1 estimate until the physical steering-rack branch is integrated.',
      'External G90 roll-gradient and understeer-gradient references are still needed.',
    ],
    reference: reference.reference,
    telemetryFile,
    graphFiles: [graph, sweepFile],
  };
}

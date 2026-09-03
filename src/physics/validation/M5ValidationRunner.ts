import { existsSync, readFileSync } from 'node:fs';
import {
  M5_REFERENCE_DATA,
  M5_REFERENCE_DATA_NEEDED,
  findM5Reference,
  type ValidationReference,
} from './M5ReferenceData';
import {
  M5_DERIVED_REFERENCE_DATA,
  findM5DerivedReference,
} from './M5DerivedReferenceData';
import { runCorrectedValidationTests } from './M5ValidationCorrectedTests';
import { ensureArtifactDir, writeJson, writeMarkdown, writeRowsCsv } from './ValidationArtifacts';

const DT = 1 / 120;
type Status = 'PASS' | 'WARNING' | 'FAIL' | 'NO REFERENCE DATA';

function parseArg(name: string): string | null {
  const exact = process.argv.find((arg) => arg.startsWith(`--${name}=`));
  if (exact) return exact.slice(name.length + 3);
  const idx = process.argv.indexOf(`--${name}`);
  if (idx >= 0 && process.argv[idx + 1] && !process.argv[idx + 1].startsWith('--')) return process.argv[idx + 1];
  return null;
}

function metricIndex(report: any): Record<string, number> {
  const out: Record<string, number> = {};
  for (const result of report.results ?? []) {
    for (const [metric, value] of Object.entries(result.metrics ?? {})) {
      if (typeof value === 'number' && Number.isFinite(value)) out[`${result.id}.${metric}`] = value;
    }
  }
  return out;
}

function regressionDeltas(current: any, baseline: any) {
  const a = metricIndex(baseline);
  const b = metricIndex(current);
  return Object.keys(b)
    .filter((metric) => Number.isFinite(a[metric]))
    .map((metric) => ({
      metric,
      before: a[metric],
      after: b[metric],
      percent: Math.abs(a[metric]) > 1e-12 ? ((b[metric] - a[metric]) / Math.abs(a[metric])) * 100 : null,
    }))
    .sort((x, y) => Math.abs((y.percent as number) ?? 0) - Math.abs((x.percent as number) ?? 0));
}

function assess(value: unknown, reference?: ValidationReference) {
  if (typeof value !== 'number' || !Number.isFinite(value) || !reference) {
    return { status: 'NO REFERENCE DATA' as Status, errorPercent: null as number | null };
  }
  const min = reference.min ?? reference.target;
  const max = reference.max ?? reference.target;
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    return { status: 'NO REFERENCE DATA' as Status, errorPercent: null as number | null };
  }
  const target = reference.target ?? ((min as number) + (max as number)) * 0.5;
  const errorPercent = Math.abs(target) > 1e-12 ? ((value - target) / target) * 100 : null;
  if (value >= (min as number) && value <= (max as number)) {
    return { status: 'PASS' as Status, errorPercent };
  }
  const span = Math.max(Math.abs((max as number) - (min as number)), Math.abs(target) * 0.01, 1e-6);
  if (value >= (min as number) - span * 0.5 && value <= (max as number) + span * 0.5) {
    return { status: 'WARNING' as Status, errorPercent };
  }
  return { status: 'FAIL' as Status, errorPercent };
}

function combineStatuses(statuses: Status[]): Status {
  if (statuses.includes('FAIL')) return 'FAIL';
  if (statuses.includes('WARNING')) return 'WARNING';
  if (statuses.every((status) => status === 'NO REFERENCE DATA')) return 'NO REFERENCE DATA';
  if (statuses.includes('PASS')) return 'PASS';
  return 'NO REFERENCE DATA';
}

function rescoreAcceleration(results: any[]) {
  const acceleration = results.find((result) => result.id === 'acceleration');
  if (!acceleration) return;

  const zeroTo100 = assess(
    acceleration.metrics.zeroTo100KmhSec,
    findM5Reference('zeroTo100KmhSec')
  );
  const zeroTo60True = assess(
    acceleration.metrics.zeroTo60MphTrueStartSec,
    findM5Reference('zeroTo60MphTrueStartSec')
  );
  const quarterTrueStartSec = acceleration.metrics.quarterMileSec;
  const quarter = assess(
    quarterTrueStartSec,
    findM5DerivedReference('quarterMileTrueStartSec')
  );
  const trap = assess(
    acceleration.metrics.quarterMileTrapMph,
    findM5Reference('quarterMileTrapMph')
  );

  acceleration.metrics.quarterMileTrueStartSec = quarterTrueStartSec;
  acceleration.metrics.zeroTo60TrueStartReferenceErrorPercent = zeroTo60True.errorPercent;
  acceleration.metrics.quarterMileTrueStartReferenceErrorPercent = quarter.errorPercent;
  acceleration.metrics.quarterMileTrapReferenceErrorPercent = trap.errorPercent;
  acceleration.status = combineStatuses([
    zeroTo100.status,
    zeroTo60True.status,
    quarter.status,
    trap.status,
  ]);

  acceleration.referenceChecks = {
    zeroTo100Kmh: {
      status: zeroTo100.status,
      reference: findM5Reference('zeroTo100KmhSec'),
    },
    zeroTo60MphTrueStart: {
      status: zeroTo60True.status,
      reference: findM5Reference('zeroTo60MphTrueStartSec'),
    },
    quarterMileTrueStart: {
      status: quarter.status,
      reference: findM5DerivedReference('quarterMileTrueStartSec'),
    },
    quarterMileTrap: {
      status: trap.status,
      reference: findM5Reference('quarterMileTrapMph'),
    },
  };

  const diagnostics = Array.isArray(acceleration.diagnostics) ? acceleration.diagnostics : [];
  const cleaned = diagnostics.filter((diagnostic: string) =>
    !diagnostic.startsWith('Quarter-mile comparison:')
  );
  if (quarter.status !== 'PASS') {
    cleaned.push(
      `Quarter-mile comparison: simulator true-start ${Number(quarterTrueStartSec).toFixed(3)} s vs rollout-adjusted engineering target 11.1 s (${quarter.status}). This does not override the separate hard C/D 10.9 s rollout-convention measurement.`
    );
  }
  acceleration.diagnostics = cleaned;
  acceleration.summary = `0–100 km/h ${Number(acceleration.metrics.zeroTo100KmhSec).toFixed(3)} s; true-start 0–60 mph ${Number(acceleration.metrics.zeroTo60MphTrueStartSec).toFixed(3)} s; quarter mile ${Number(quarterTrueStartSec).toFixed(3)} s @ ${Number(acceleration.metrics.quarterMileTrapMph).toFixed(2)} mph.`;
}

function main() {
  const artifactDir = parseArg('artifacts') ?? 'artifacts/m5-validation';
  const baseDir = parseArg('base') ?? `${artifactDir}/base`;
  const baseReportPath = `${baseDir}/m5-validation-report.json`;
  if (!existsSync(baseReportPath)) {
    throw new Error(`Base validation report not found: ${baseReportPath}. Run the core subset first.`);
  }
  ensureArtifactDir(artifactDir);
  const base = JSON.parse(readFileSync(baseReportPath, 'utf8'));
  const corrected = runCorrectedValidationTests(artifactDir);
  const replacement = new Map(corrected.map((result) => [result.id, result]));
  const results = (base.results ?? []).map((result: any) => replacement.get(result.id) ?? result);
  for (const result of corrected) {
    if (!results.some((existing: any) => existing.id === result.id)) results.push(result);
  }

  // The core acceleration test records quarter-mile and trap data, but its original
  // verdict was driven only by the 0–100/0–60 checks. Re-score the whole acceleration
  // envelope here so a perfect launch cannot hide a slower quarter mile.
  rescoreAcceleration(results);

  const statusCounts = results.reduce((acc: Record<string, number>, result: any) => {
    acc[result.status] = (acc[result.status] ?? 0) + 1;
    return acc;
  }, {});

  const report: any = {
    schemaVersion: 2,
    generatedAt: new Date().toISOString(),
    vehicleConfiguration: '2025 BMW M5 G90 validation calibration',
    fixedDtSec: DT,
    fixedPhysicsHz: 1 / DT,
    coordinateContract: '+X left, +Y up, +Z forward; positive steer/yaw = left; wheel order FL/FR/RL/RR',
    antiGamingRule: 'All measurements use the normal Simulation/Vehicle path; validation code prescribes only driver inputs, road geometry/material and initial conditions.',
    harnessRevision: 'v2 hardened: normal-driveline brake entry, validated skidpad speed/radius hold, first-sample step thresholds, actual unsprung hub bump telemetry, per-step energy accounting, full acceleration-envelope scoring',
    statusCounts,
    results,
    references: [
      ...Object.values(M5_REFERENCE_DATA),
      ...Object.values(M5_DERIVED_REFERENCE_DATA),
    ],
    referenceDataNeeded: M5_REFERENCE_DATA_NEEDED,
    placeholders: base.placeholders ?? {},
  };

  const baselinePath = parseArg('baseline');
  if (baselinePath && existsSync(baselinePath)) {
    report.regressionDeltas = regressionDeltas(report, JSON.parse(readFileSync(baselinePath, 'utf8')));
  }

  writeJson(`${artifactDir}/m5-validation-report.json`, report);
  writeMarkdown(`${artifactDir}/m5-validation-report.md`, report);
  writeRowsCsv(`${artifactDir}/m5-validation-metrics.csv`, results.flatMap((result: any) =>
    Object.entries(result.metrics ?? {}).map(([metric, value]) => ({
      test: result.id,
      status: result.status,
      validation_class: result.validationClass,
      metric,
      value,
    }))
  ));

  console.log('\n2025 BMW M5 Vehicle Dynamics Validation — hardened report');
  console.log(`PASS ${statusCounts.PASS ?? 0} | WARNING ${statusCounts.WARNING ?? 0} | FAIL ${statusCounts.FAIL ?? 0} | NO REFERENCE DATA ${statusCounts['NO REFERENCE DATA'] ?? 0}`);
  console.log(`Report: ${artifactDir}/m5-validation-report.json`);
  console.log(`Markdown: ${artifactDir}/m5-validation-report.md`);

  const blockingFailure = results.some((result: any) => result.blocking && result.status === 'FAIL');
  const strictFailure = process.argv.includes('--strict') && results.some((result: any) => result.status === 'FAIL');
  if (blockingFailure || strictFailure) process.exitCode = 1;
}

main();

/**
 * Blocking, deterministic source-level QA for the Showcase Circuit.
 *
 * This exists because a production build and vehicle regression suite can both
 * pass while a generated race track is geometrically undrivable. It intentionally
 * measures the track itself and exits non-zero on blocking defects.
 *
 * Run: npx tsx src/graphics/tracks/showcaseCircuitQA.ts
 */
import * as THREE from 'three';
import {
  BARRIER_OFFSET_M,
  CURB_WIDTH_M,
  OUTER_RUNOFF_M,
  PATH_SAMPLES,
  RUNOFF_WIDTH_M,
  SHOWCASE_PATH,
  SHOWCASE_SPAWN_U,
  ShowcaseCircuitSurfaceProvider,
  TRACK_HALF_WIDTH_M,
  TRACK_WIDTH_M,
} from './showcaseCircuit';

type Status = 'PASS' | 'WARN' | 'FAIL';
interface Result {
  id: string;
  status: Status;
  summary: string;
  details?: string[];
}

const results: Result[] = [];

function record(result: Result): void {
  results.push(result);
  console.log(`[${result.status}] ${result.id}: ${result.summary}`);
  for (const detail of result.details ?? []) console.log(`  - ${detail}`);
}

function horizontalRadius(
  p0: THREE.Vector3,
  p1: THREE.Vector3,
  p2: THREE.Vector3,
): number {
  const ax = p1.x - p0.x;
  const az = p1.z - p0.z;
  const bx = p2.x - p1.x;
  const bz = p2.z - p1.z;
  const cx = p2.x - p0.x;
  const cz = p2.z - p0.z;
  const a = Math.hypot(ax, az);
  const b = Math.hypot(bx, bz);
  const c = Math.hypot(cx, cz);
  const area2 = Math.abs(ax * cz - cx * az);
  if (area2 < 1e-10 || a < 1e-8 || b < 1e-8 || c < 1e-8) return Number.POSITIVE_INFINITY;
  return (a * b * c) / (2 * area2);
}

function loopDistanceM(a: number, b: number, lengthM: number): number {
  const direct = Math.abs(a - b);
  return Math.min(direct, Math.max(0, lengthM - direct));
}

function surfaceSignature(provider: ShowcaseCircuitSurfaceProvider, x: number, z: number): string {
  const s = provider.sampleSurface(x, z);
  return [
    s.type,
    s.elevation.toFixed(8),
    s.normal.x.toFixed(8),
    s.normal.y.toFixed(8),
    s.normal.z.toFixed(8),
    s.friction.toFixed(8),
  ].join('|');
}

export function runShowcaseCircuitQA(): Result[] {
  results.length = 0;
  const path = SHOWCASE_PATH;
  const samples = path.samples;
  const n = samples.length;

  // 1) Basic finite/closed-loop sanity.
  {
    let nonFinite = 0;
    let maxStep = 0;
    let maxStepIndex = 0;
    for (let i = 0; i < n; i++) {
      const s = samples[i];
      const values = [
        s.center.x, s.center.y, s.center.z,
        s.tangent.x, s.tangent.y, s.tangent.z,
        s.normal.x, s.normal.y, s.normal.z,
        s.banking, s.distance,
      ];
      if (!values.every(Number.isFinite)) nonFinite++;
      const step = s.center.distanceTo(samples[(i + 1) % n].center);
      if (step > maxStep) {
        maxStep = step;
        maxStepIndex = i;
      }
    }

    const closeStep = samples[n - 1].center.distanceTo(samples[0].center);
    const fail = nonFinite > 0 || maxStep > 8 || closeStep > 8;
    record({
      id: 'sampling-and-loop-closure',
      status: fail ? 'FAIL' : 'PASS',
      summary: `length=${path.lengthM.toFixed(1)}m samples=${n} maxStep=${maxStep.toFixed(2)}m closure=${closeStep.toFixed(2)}m`,
      details: [`maxStepIndex=${maxStepIndex}`, `nonFinite=${nonFinite}`],
    });
  }

  // 2) Centerline curvature. The initial generated track had a ~0.1 m closure
  // cusp and many sub-20 m radii. This is the most important regression gate.
  let minimumRadiusM = Number.POSITIVE_INFINITY;
  let minimumRadiusIndex = 0;
  {
    for (let i = 0; i < n; i++) {
      const radius = horizontalRadius(
        samples[(i - 1 + n) % n].center,
        samples[i].center,
        samples[(i + 1) % n].center,
      );
      if (radius < minimumRadiusM) {
        minimumRadiusM = radius;
        minimumRadiusIndex = i;
      }
    }

    const sample = samples[minimumRadiusIndex];
    const requiredRoadWheelDeg = THREE.MathUtils.radToDeg(
      Math.atan(3.00482 / Math.max(0.001, minimumRadiusM)),
    );
    const status: Status = minimumRadiusM < 28
      ? 'FAIL'
      : minimumRadiusM < 32
        ? 'WARN'
        : 'PASS';
    record({
      id: 'minimum-horizontal-radius',
      status,
      summary: `minR=${minimumRadiusM.toFixed(2)}m at u=${sample.u.toFixed(4)}`,
      details: [
        `xyz=(${sample.center.x.toFixed(1)}, ${sample.center.y.toFixed(1)}, ${sample.center.z.toFixed(1)})`,
        `20m road half-width=${TRACK_HALF_WIDTH_M.toFixed(1)}m`,
        `kinematic center road-wheel angle≈${requiredRoadWheelDeg.toFixed(1)}°`,
      ],
    });
  }

  // 3) Grade and vertical transition rate.
  {
    const grades = samples.map((sample) =>
      sample.tangent.y / Math.max(1e-8, Math.hypot(sample.tangent.x, sample.tangent.z))
    );
    let maxGrade = 0;
    let maxGradeIndex = 0;
    let maxGradeRate = 0;
    let maxGradeRateIndex = 0;

    for (let i = 0; i < n; i++) {
      const grade = Math.abs(grades[i]);
      if (grade > maxGrade) {
        maxGrade = grade;
        maxGradeIndex = i;
      }
      const ds = samples[i].center.distanceTo(samples[(i + 1) % n].center);
      const rate = Math.abs(grades[(i + 1) % n] - grades[i]) / Math.max(1e-6, ds);
      if (rate > maxGradeRate) {
        maxGradeRate = rate;
        maxGradeRateIndex = i;
      }
    }

    const status: Status = maxGrade > 0.08 || maxGradeRate > 0.008
      ? 'FAIL'
      : maxGrade > 0.06 || maxGradeRate > 0.004
        ? 'WARN'
        : 'PASS';
    record({
      id: 'grade-and-vertical-curvature',
      status,
      summary: `maxGrade=${(maxGrade * 100).toFixed(2)}% maxGradeRate=${maxGradeRate.toFixed(5)}/m`,
      details: [`gradeIndex=${maxGradeIndex}`, `gradeRateIndex=${maxGradeRateIndex}`],
    });
  }

  // 4) Banking amplitude/rate and tangent/normal continuity.
  {
    let maxBank = 0;
    let maxBankRate = 0;
    let minimumTangentDot = 1;
    let minimumNormalDot = 1;
    let badNormalCount = 0;

    for (let i = 0; i < n; i++) {
      const a = samples[i];
      const b = samples[(i + 1) % n];
      maxBank = Math.max(maxBank, Math.abs(a.banking));
      const ds = a.center.distanceTo(b.center);
      maxBankRate = Math.max(
        maxBankRate,
        Math.abs(b.banking - a.banking) / Math.max(1e-6, ds),
      );
      minimumTangentDot = Math.min(minimumTangentDot, a.tangent.dot(b.tangent));
      minimumNormalDot = Math.min(minimumNormalDot, a.normal.dot(b.normal));
      if (a.normal.y <= 0 || !Number.isFinite(a.normal.y)) badNormalCount++;
    }

    const status: Status =
      maxBank > THREE.MathUtils.degToRad(8) ||
      maxBankRate > 0.006 ||
      minimumTangentDot < 0.975 ||
      minimumNormalDot < 0.975 ||
      badNormalCount > 0
        ? 'FAIL'
        : maxBank > THREE.MathUtils.degToRad(6) || maxBankRate > 0.003
          ? 'WARN'
          : 'PASS';

    record({
      id: 'bank-and-frame-continuity',
      status,
      summary: `maxBank=${THREE.MathUtils.radToDeg(maxBank).toFixed(2)}° bankRate=${maxBankRate.toFixed(5)}rad/m`,
      details: [
        `minTangentDot=${minimumTangentDot.toFixed(6)}`,
        `minNormalDot=${minimumNormalDot.toFixed(6)}`,
        `badNormals=${badNormalCount}`,
      ],
    });
  }

  // 5) Ribbon basis and fold protection.
  {
    let badBasis = 0;
    let minimumBasisDot = 1;
    for (let i = 0; i < n; i += 5) {
      const s = samples[i];
      const cross = new THREE.Vector3().crossVectors(s.tangent, s.bankedLateral).normalize();
      const dot = cross.dot(s.normal);
      minimumBasisDot = Math.min(minimumBasisDot, dot);
      if (dot < 0.985 || s.bankedLateral.length() < 0.99 || s.bankedLateral.length() > 1.01) {
        badBasis++;
      }
    }
    const folded = minimumRadiusM <= TRACK_HALF_WIDTH_M + CURB_WIDTH_M + 2;
    record({
      id: 'ribbon-orientation',
      status: badBasis > 0 || folded ? 'FAIL' : 'PASS',
      summary: `badBasis=${badBasis} minBasisDot=${minimumBasisDot.toFixed(5)} folded=${folded}`,
      details: [`minRadius=${minimumRadiusM.toFixed(2)}m`, `road+kerb half-span=${(TRACK_HALF_WIDTH_M + CURB_WIDTH_M).toFixed(2)}m`],
    });
  }

  // 6) Non-adjacent centerline separation. The v2 route should have no bridge,
  // no underpass and no at-grade self-intersection at all.
  {
    let minimumXZ = Number.POSITIVE_INFINITY;
    let minimumPair = [-1, -1];
    const stride = 3;
    for (let i = 0; i < n; i += stride) {
      for (let j = i + stride; j < n; j += stride) {
        const along = loopDistanceM(samples[i].distance, samples[j].distance, path.lengthM);
        if (along < 100) continue;
        const xz = Math.hypot(
          samples[i].center.x - samples[j].center.x,
          samples[i].center.z - samples[j].center.z,
        );
        if (xz < minimumXZ) {
          minimumXZ = xz;
          minimumPair = [i, j];
        }
      }
    }

    const status: Status = minimumXZ < TRACK_WIDTH_M + 6
      ? 'FAIL'
      : minimumXZ < TRACK_WIDTH_M + 20
        ? 'WARN'
        : 'PASS';
    record({
      id: 'non-adjacent-route-separation',
      status,
      summary: `closest=${minimumXZ.toFixed(1)}m for points >100m apart along lap`,
      details: [`pair=${minimumPair[0]},${minimumPair[1]}`],
    });
  }

  // 7) Surface provider must be query-order independent.
  {
    const indices = [0, 97, 211, 359, 487, 653, 811].map((i) => i % n);
    const points = indices.map((index) => {
      const sample = samples[index];
      return { index, x: sample.center.x, z: sample.center.z };
    });
    const forwardProvider = new ShowcaseCircuitSurfaceProvider(path);
    const reverseProvider = new ShowcaseCircuitSurfaceProvider(path);
    const forward = new Map<number, string>();
    const reverse = new Map<number, string>();

    for (const point of points) {
      forward.set(point.index, surfaceSignature(forwardProvider, point.x, point.z));
    }
    for (const point of [...points].reverse()) {
      reverse.set(point.index, surfaceSignature(reverseProvider, point.x, point.z));
    }

    const mismatches = points.filter((point) => forward.get(point.index) !== reverse.get(point.index));
    record({
      id: 'surface-query-determinism',
      status: mismatches.length > 0 ? 'FAIL' : 'PASS',
      summary: `orderDependentSamples=${mismatches.length}`,
      details: mismatches.map((point) => `sample=${point.index}`),
    });
  }

  // 7b) Physics surface lookup must be continuous between the discrete path samples.
  // A nearest-sample implementation creates a longitudinal staircase even when the
  // rendered ribbon and source curve are smooth, which excites the unsprung masses.
  {
    const provider = new ShowcaseCircuitSurfaceProvider(path);
    const probeCount = PATH_SAMPLES * 4;
    let maxProjectionErrorM = 0;
    let maxElevationErrorM = 0;
    let minimumNormalDot = 1;

    for (let i = 0; i < probeCount; i++) {
      // Avoid probing only exact sample boundaries; quarter-sample offsets catch
      // the old snapping behavior deterministically.
      const u = (i + 0.37) / probeCount;
      const expected = path.sampleAt(u);
      const hit = path.closest(expected.center.x, expected.center.z);
      const surface = provider.sampleSurface(expected.center.x, expected.center.z);

      maxProjectionErrorM = Math.max(
        maxProjectionErrorM,
        Math.hypot(
          hit.sample.center.x - expected.center.x,
          hit.sample.center.z - expected.center.z,
        ),
      );
      maxElevationErrorM = Math.max(
        maxElevationErrorM,
        Math.abs(surface.elevation - expected.center.y),
      );
      minimumNormalDot = Math.min(
        minimumNormalDot,
        expected.normal.x * surface.normal.x +
          expected.normal.y * surface.normal.y +
          expected.normal.z * surface.normal.z,
      );
    }

    const fail =
      maxProjectionErrorM > 0.02 ||
      maxElevationErrorM > 0.005 ||
      minimumNormalDot < 0.999;
    record({
      id: 'continuous-physics-surface-projection',
      status: fail ? 'FAIL' : 'PASS',
      summary:
        `maxXZError=${(maxProjectionErrorM * 1000).toFixed(1)}mm ` +
        `maxYError=${(maxElevationErrorM * 1000).toFixed(1)}mm minNormalDot=${minimumNormalDot.toFixed(6)}`,
      details: [
        `probes=${probeCount}`,
        'guards against fixed-sample staircase excitation of wheel/hub dynamics',
      ],
    });
  }

  // 8) Spawn center + M5-sized wheel offsets must all land on the same road deck.
  {
    const spawn = path.spawn();
    const provider = new ShowcaseCircuitSurfaceProvider(path);
    provider.resetHint(spawn.elevation);
    const cosYaw = Math.cos(spawn.yaw);
    const sinYaw = Math.sin(spawn.yaw);
    const wheelOffsets = [
      { id: 'FL', x: 0.82, z: 1.50 },
      { id: 'FR', x: -0.82, z: 1.50 },
      { id: 'RL', x: 0.82, z: -1.50 },
      { id: 'RR', x: -0.82, z: -1.50 },
    ];
    const rows = wheelOffsets.map((offset) => {
      const x = spawn.x + offset.x * cosYaw + offset.z * sinYaw;
      const z = spawn.z - offset.x * sinYaw + offset.z * cosYaw;
      return { id: offset.id, surface: provider.sampleSurface(x, z) };
    });
    const offRoad = rows.filter((row) => !['asphalt', 'racing_line'].includes(row.surface.type));
    const elevations = rows.map((row) => row.surface.elevation);
    const spread = Math.max(...elevations) - Math.min(...elevations);

    record({
      id: 'spawn-wheel-coherence',
      status: offRoad.length > 0 || spread > 0.75 ? 'FAIL' : 'PASS',
      summary: `offRoad=${offRoad.length}/4 elevationSpread=${spread.toFixed(3)}m`,
      details: rows.map((row) => `${row.id}: ${row.surface.type} y=${row.surface.elevation.toFixed(3)}`),
    });
  }

  // 9) Surface widths and transition continuity must match the visible geometry.
  {
    const station = path.sampleAt(0.36);
    const provider = new ShowcaseCircuitSurfaceProvider(path);
    const probes = [
      { lateral: TRACK_HALF_WIDTH_M - 0.2, expected: 'road' },
      { lateral: TRACK_HALF_WIDTH_M + 0.5, expected: 'kerb' },
      { lateral: TRACK_HALF_WIDTH_M + CURB_WIDTH_M + 1, expected: 'runoff' },
      { lateral: OUTER_RUNOFF_M - 0.2, expected: 'runoff' },
      { lateral: OUTER_RUNOFF_M + 2, expected: 'gravel' },
    ];
    let mismatches = 0;
    const details: string[] = [];

    for (const probe of probes) {
      const x = station.center.x + station.lateral.x * probe.lateral;
      const z = station.center.z + station.lateral.z * probe.lateral;
      const surface = provider.sampleSurface(x, z);
      const actual = surface.type === 'asphalt' || surface.type === 'racing_line'
        ? 'road'
        : surface.type === 'marbles'
          ? 'runoff'
          : surface.type;
      if (actual !== probe.expected) mismatches++;
      details.push(`${probe.lateral.toFixed(2)}m: expected=${probe.expected} actual=${actual} y=${surface.elevation.toFixed(3)}`);
    }

    const boundaryOffsets = [TRACK_HALF_WIDTH_M, TRACK_HALF_WIDTH_M + CURB_WIDTH_M, OUTER_RUNOFF_M];
    let maximumBoundaryJump = 0;
    for (const boundary of boundaryOffsets) {
      const beforeX = station.center.x + station.lateral.x * (boundary - 0.01);
      const beforeZ = station.center.z + station.lateral.z * (boundary - 0.01);
      const afterX = station.center.x + station.lateral.x * (boundary + 0.01);
      const afterZ = station.center.z + station.lateral.z * (boundary + 0.01);
      const before = provider.sampleSurface(beforeX, beforeZ);
      const after = provider.sampleSurface(afterX, afterZ);
      maximumBoundaryJump = Math.max(maximumBoundaryJump, Math.abs(after.elevation - before.elevation));
    }

    record({
      id: 'surface-widths-and-boundaries',
      status: mismatches > 0 || maximumBoundaryJump > 0.04 ? 'FAIL' : 'PASS',
      summary: `mismatches=${mismatches} maxBoundaryJump=${(maximumBoundaryJump * 1000).toFixed(1)}mm`,
      details: [
        ...details,
        `road=${TRACK_WIDTH_M}m curb=${CURB_WIDTH_M}m runoff=${RUNOFF_WIDTH_M}m outer=${OUTER_RUNOFF_M.toFixed(2)}m`,
      ],
    });
  }

  // 10) Trackside exclusion invariant used by all repeated barriers.
  {
    const clearance = BARRIER_OFFSET_M - OUTER_RUNOFF_M;
    record({
      id: 'barrier-recovery-clearance',
      status: clearance < 2 ? 'FAIL' : 'PASS',
      summary: `barrier is ${clearance.toFixed(2)}m outside full runoff`,
    });
  }

  // 11) Lightweight kinematic feasibility: not a physics override, just a guard that
  // the measured centerline does not require impossible steering geometry.
  {
    const wheelbaseM = 3.00482;
    const requiredSteerDeg = THREE.MathUtils.radToDeg(
      Math.atan(wheelbaseM / Math.max(0.001, minimumRadiusM)),
    );
    const frictionSpeedKmh = Math.sqrt(0.90 * 9.81 * Math.max(0.001, minimumRadiusM)) * 3.6;
    record({
      id: 'kinematic-lap-feasibility',
      status: requiredSteerDeg > 18 || frictionSpeedKmh < 45 ? 'FAIL' : 'PASS',
      summary: `tightest-corner steer≈${requiredSteerDeg.toFixed(1)}° 0.90g speed≈${frictionSpeedKmh.toFixed(1)}km/h`,
      details: [`spawnU=${SHOWCASE_SPAWN_U.toFixed(3)}`, `pathSamples=${PATH_SAMPLES}`],
    });
  }

  return [...results];
}

function main(): void {
  console.log('Showcase Circuit QA — geometry, surface determinism, spawn and recovery-zone checks');
  runShowcaseCircuitQA();
  const failures = results.filter((result) => result.status === 'FAIL');
  const warnings = results.filter((result) => result.status === 'WARN');
  const passes = results.filter((result) => result.status === 'PASS');
  console.log(`\nTrack QA: ${passes.length} PASS | ${warnings.length} WARN | ${failures.length} FAIL`);
  if (failures.length > 0) {
    console.error(`Blocking track defects: ${failures.map((failure) => failure.id).join(', ')}`);
    process.exit(1);
  }
}

const invokedPath = process.argv[1] ?? '';
if (invokedPath.endsWith('showcaseCircuitQA.ts') || invokedPath.endsWith('showcaseCircuitQA.js')) {
  main();
}

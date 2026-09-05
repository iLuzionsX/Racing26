/**
 * Blocking deterministic QA for the Racerrhi APEX / Côte d'Azur circuit port.
 *
 * The key invariant is stronger than "the track renders": the physics sampler must
 * agree with the exact visible road/kerb/gravel geometry, and lateral material
 * changes must not create hidden height steps that can corrupt the M5 after a hit.
 */
import * as THREE from 'three';
import {
  BARRIER_OFFSET_M,
  CURB_WIDTH_M,
  OUTER_RUNOFF_M,
  PATH_SAMPLES,
  RACERRHI_RECOVERY_LIMIT_M,
  RUNOFF_WIDTH_M,
  SHOWCASE_PATH,
  ShowcaseCircuitSurfaceProvider,
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
  console.log('[' + result.status + '] ' + result.id + ': ' + result.summary);
  for (const detail of result.details ?? []) console.log('  - ' + detail);
}

function horizontalRadius(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3): number {
  const ab = Math.hypot(b.x - a.x, b.z - a.z);
  const bc = Math.hypot(c.x - b.x, c.z - b.z);
  const ac = Math.hypot(c.x - a.x, c.z - a.z);
  const area2 = Math.abs((b.x - a.x) * (c.z - a.z) - (c.x - a.x) * (b.z - a.z));
  if (area2 < 1e-10 || ab < 1e-8 || bc < 1e-8 || ac < 1e-8) return Infinity;
  return (ab * bc * ac) / (2 * area2);
}

function sampleAtLateral(provider: ShowcaseCircuitSurfaceProvider, u: number, lateralM: number) {
  const s = SHOWCASE_PATH.sampleAt(u);
  return provider.sampleSurface(
    s.center.x + s.lateral.x * lateralM,
    s.center.z + s.lateral.z * lateralM,
  );
}

export function runShowcaseCircuitQA(): Result[] {
  results.length = 0;
  const path = SHOWCASE_PATH;
  const provider = new ShowcaseCircuitSurfaceProvider(path);
  const samples = path.samples;

  const geometryLocked =
    TRACK_WIDTH_M === 15 &&
    CURB_WIDTH_M === 0.9 &&
    RUNOFF_WIDTH_M === 8.1 &&
    OUTER_RUNOFF_M === 16.5 &&
    BARRIER_OFFSET_M === 16 &&
    RACERRHI_RECOVERY_LIMIT_M === 14.5 &&
    PATH_SAMPLES === 1400;
  record({
    id: 'racerrhi-geometry-lock',
    status: geometryLocked ? 'PASS' : 'FAIL',
    summary:
      'road=' + TRACK_WIDTH_M + 'm curb=' + CURB_WIDTH_M + 'm gravelHalf=' +
      OUTER_RUNOFF_M + 'm rail=' + BARRIER_OFFSET_M + 'm samples=' + PATH_SAMPLES,
  });

  let maxStep = 0;
  let maxGrade = 0;
  let minNormalY = 1;
  let nonFinite = 0;
  for (let i = 0; i < samples.length; i++) {
    const a = samples[i];
    const b = samples[(i + 1) % samples.length];
    const dxz = Math.hypot(b.center.x - a.center.x, b.center.z - a.center.z);
    const dy = b.center.y - a.center.y;
    maxStep = Math.max(maxStep, a.center.distanceTo(b.center));
    maxGrade = Math.max(maxGrade, Math.abs(dy) / Math.max(1e-6, dxz));
    minNormalY = Math.min(minNormalY, a.normal.y);
    if (![a.center.x, a.center.y, a.center.z, a.tangent.x, a.tangent.y, a.tangent.z].every(Number.isFinite)) {
      nonFinite++;
    }
  }
  record({
    id: 'path-continuity',
    status: nonFinite > 0 || maxStep > 3.0 || maxGrade > 0.10 || minNormalY < 0.98 ? 'FAIL' : 'PASS',
    summary:
      'length=' + path.lengthM.toFixed(1) + 'm maxStep=' + maxStep.toFixed(2) +
      'm maxGrade=' + (maxGrade * 100).toFixed(2) + '% minNormalY=' + minNormalY.toFixed(4),
    details: ['nonFinite=' + nonFinite],
  });

  let minNonAdjacentXZ = Infinity;
  let minPair = '';
  for (let i = 0; i < samples.length; i += 7) {
    for (let j = i + 70; j < samples.length; j += 7) {
      const wrap = Math.min(j - i, samples.length - (j - i));
      if (wrap < 70) continue;
      const d = Math.hypot(
        samples[i].center.x - samples[j].center.x,
        samples[i].center.z - samples[j].center.z,
      );
      if (d < minNonAdjacentXZ) {
        minNonAdjacentXZ = d;
        minPair = i + ',' + j;
      }
    }
  }
  record({
    id: 'route-separation',
    status: minNonAdjacentXZ < TRACK_WIDTH_M ? 'FAIL' : minNonAdjacentXZ < TRACK_WIDTH_M + 8 ? 'WARN' : 'PASS',
    summary: 'closest non-adjacent centerlines=' + minNonAdjacentXZ.toFixed(1) + 'm',
    details: ['pair=' + minPair],
  });

  let surfaceErrors = 0;
  let maxCrossTrackHeightDelta = 0;
  const surfaceDetails: string[] = [];
  for (const u of [0, 0.11, 0.27, 0.44, 0.61, 0.78, 0.91]) {
    const center = sampleAtLateral(provider, u, 0);
    const road = sampleAtLateral(provider, u, 6.6);
    const kerb = sampleAtLateral(provider, u, 7.6);
    const gravel = sampleAtLateral(provider, u, 10.0);

    if (center.type !== 'asphalt' || Math.abs(center.friction - 1.0) > 1e-9) surfaceErrors++;
    if (road.type !== 'asphalt' || Math.abs(road.friction - 1.0) > 1e-9) surfaceErrors++;
    if (kerb.type !== 'kerb' || Math.abs(kerb.friction - 0.88) > 1e-9) surfaceErrors++;
    if (gravel.type !== 'gravel' || Math.abs(gravel.friction - 0.55) > 1e-9) surfaceErrors++;

    maxCrossTrackHeightDelta = Math.max(
      maxCrossTrackHeightDelta,
      Math.abs(center.elevation - road.elevation),
      Math.abs(center.elevation - kerb.elevation),
      Math.abs(center.elevation - gravel.elevation),
    );
    surfaceDetails.push(
      'u=' + u.toFixed(2) + ' road=' + road.type + '/' + road.friction.toFixed(2) +
      ' kerb=' + kerb.type + '/' + kerb.friction.toFixed(2) +
      ' gravel=' + gravel.type + '/' + gravel.friction.toFixed(2)
    );
  }

  record({
    id: 'visible-surface-equals-physics-surface',
    status: surfaceErrors > 0 || maxCrossTrackHeightDelta > 0.005 ? 'FAIL' : 'PASS',
    summary:
      'classificationErrors=' + surfaceErrors +
      ' maxCrossTrackProjectionDelta=' + (maxCrossTrackHeightDelta * 1000).toFixed(3) + 'mm',
    details: surfaceDetails,
  });

  const probes = [0.03, 0.19, 0.38, 0.57, 0.74, 0.93];
  const forward = probes.map((u) => {
    const s = path.sampleAt(u);
    return provider.sampleSurface(s.center.x, s.center.z);
  });
  const reverseProvider = new ShowcaseCircuitSurfaceProvider(path);
  const reverse = [...probes].reverse().map((u) => {
    const s = path.sampleAt(u);
    return reverseProvider.sampleSurface(s.center.x, s.center.z);
  }).reverse();
  const orderMismatches = forward.filter((a, i) =>
    a.type !== reverse[i].type ||
    Math.abs(a.elevation - reverse[i].elevation) > 1e-9 ||
    Math.abs(a.friction - reverse[i].friction) > 1e-9
  ).length;
  record({
    id: 'surface-query-determinism',
    status: orderMismatches ? 'FAIL' : 'PASS',
    summary: 'orderDependentSamples=' + orderMismatches,
  });

  const spawn = path.spawn();
  const wheelOffsets = [
    { id: 'FL', x: 0.842, z: 1.367 },
    { id: 'FR', x: -0.842, z: 1.367 },
    { id: 'RL', x: 0.830, z: -1.638 },
    { id: 'RR', x: -0.830, z: -1.638 },
  ];
  const cy = Math.cos(spawn.yaw);
  const sy = Math.sin(spawn.yaw);
  const wheelSurfaces = wheelOffsets.map((wheel) => {
    const x = spawn.x + wheel.x * cy + wheel.z * sy;
    const z = spawn.z - wheel.x * sy + wheel.z * cy;
    return { id: wheel.id, surface: provider.sampleSurface(x, z) };
  });
  const spawnOffRoad = wheelSurfaces.filter(({ surface }) => surface.type !== 'asphalt');
  record({
    id: 'spawn-wheel-coherence',
    status: spawnOffRoad.length ? 'FAIL' : 'PASS',
    summary: 'offRoad=' + spawnOffRoad.length + '/4',
    details: wheelSurfaces.map(({ id, surface }) =>
      id + ': ' + surface.type + ' mu=' + surface.friction.toFixed(2) + ' y=' + surface.elevation.toFixed(3)
    ),
  });

  let minRadius = Infinity;
  for (let i = 0; i < samples.length; i++) {
    minRadius = Math.min(
      minRadius,
      horizontalRadius(
        samples[(i - 5 + samples.length) % samples.length].center,
        samples[i].center,
        samples[(i + 5) % samples.length].center,
      ),
    );
  }
  const requiredSteer = THREE.MathUtils.radToDeg(Math.atan(3.00482 / Math.max(0.01, minRadius)));
  record({
    id: 'm5-kinematic-feasibility',
    status: minRadius < 10 || requiredSteer > 20 ? 'FAIL' : 'PASS',
    summary: 'minRadius≈' + minRadius.toFixed(1) + 'm requiredCenterSteer≈' + requiredSteer.toFixed(1) + '°',
  });

  return [...results];
}

function main(): void {
  console.log('Racerrhi Côte d Azur QA — geometry, surfaces, continuity and M5 spawn');
  runShowcaseCircuitQA();
  const failures = results.filter((result) => result.status === 'FAIL');
  const warnings = results.filter((result) => result.status === 'WARN');
  const passes = results.filter((result) => result.status === 'PASS');
  console.log('\nTrack QA: ' + passes.length + ' PASS | ' + warnings.length + ' WARN | ' + failures.length + ' FAIL');
  if (failures.length) process.exit(1);
}

const invokedPath = process.argv[1] ?? '';
if (invokedPath.endsWith('showcaseCircuitQA.ts') || invokedPath.endsWith('showcaseCircuitQA.js')) {
  main();
}

import * as THREE from 'three';
import type { ISurfaceProvider, SurfaceSample } from '../../physics/SurfaceProvider';

const TRACK_CENTER_X = 560;
const TRACK_WIDTH_M = 16;
const TRACK_HALF_WIDTH_M = TRACK_WIDTH_M / 2;
const CURB_WIDTH_M = 1.25;
const RUNOFF_WIDTH_M = 13;
const RUNOFF_BLEND_M = 12;
const MAX_HINT_STEP_M = 0.6;
const SPAWN_U = 0.012;
const PATH_SAMPLES = 720;
export const SHOWCASE_TRACK_WIDTH_M = TRACK_WIDTH_M;
export const SHOWCASE_SPAWN_U = SPAWN_U;

export interface ShowcaseSpawn {
  x: number;
  z: number;
  yaw: number;
  elevation: number;
}

export interface ShowcaseCircuitRuntime {
  group: THREE.Group;
  surfaceProvider: ShowcaseCircuitSurfaceProvider;
  spawn: ShowcaseSpawn;
  dispose: () => void;
}

interface TrackSample {
  u: number;
  center: THREE.Vector3;
  tangent: THREE.Vector3;
  lateral: THREE.Vector3;
  bankedLateral: THREE.Vector3;
  normal: THREE.Vector3;
  banking: number;
  distance: number;
}

function gaussian(u: number, center: number, width: number): number {
  let d = u - center;
  if (d > 0.5) d -= 1;
  if (d < -0.5) d += 1;
  return Math.exp(-(d * d) / Math.max(1e-6, width * width));
}

function bankingAt(u: number): number {
  // Positive roll raises the left edge. Progressive GP values only.
  // Max ~0.12 rad (6.9 deg), transitions over ~150-220 m, no high-freq esses.
  const bowl = 0.12 * gaussian(u, 0.26, 0.085);
  const crest = 0.04 * gaussian(u, 0.40, 0.06);
  const dip = -0.06 * gaussian(u, 0.56, 0.06);
  const essesWindow = gaussian(u, 0.74, 0.10);
  const esses = Math.sin((u - 0.66) * Math.PI * 4) * 0.03 * essesWindow;
  return bowl + crest + dip + esses;
}

export function showcaseBankingAt(u: number): number {
  return bankingAt(u);
}

export function wrapTrackDeltaU(a: number, b: number): number {
  let d = a - b;
  if (d > 0.5) d -= 1;
  if (d < -0.5) d += 1;
  return d;
}

export class ShowcaseTrackPath {
  public readonly curve: THREE.CatmullRomCurve3;
  public readonly samples: TrackSample[] = [];
  public readonly lengthM: number;

  constructor() {
    // Single-crossing GP loop. Lower main straight y~2 at z~-360/-140 is crossed
    // once by elevated east-west bridge y~14 at z=-220. No extra zig-zag loop.
    // Grades <6.5%, min radius target >35 m, clearance ~11-12 m.
    const raw: Array<[number, number, number]> = [
      [0, 2, -360],
      [0, 2, -250],
      [2, 3, -140],
      [70, 5, -40],
      [200, 8, 30],
      [320, 10, 120],
      [300, 11, 250],
      [180, 13, 340],
      [20, 14, 360],
      [-140, 16, 320],
      [-260, 15, 220],
      [-320, 12, 80],
      [-280, 8, -60],
      [-200, 6, -150],
      [-80, 9, -220],
      [80, 14, -220],
      [200, 12, -260],
      [140, 6, -340],
    ];

    this.curve = new THREE.CatmullRomCurve3(
      raw.map(([x, y, z]) => new THREE.Vector3(x + TRACK_CENTER_X, y, z)),
      true,
      'catmullrom',
      0.55,
    );
    this.lengthM = this.curve.getLength();

    const worldUp = new THREE.Vector3(0, 1, 0);
    let distance = 0;
    let previous: THREE.Vector3 | null = null;

    for (let i = 0; i < PATH_SAMPLES; i++) {
      const u = i / PATH_SAMPLES;
      const center = this.curve.getPointAt(u);
      const tangent = this.curve.getTangentAt(u).normalize();
      const lateral = new THREE.Vector3().crossVectors(worldUp, tangent).normalize();
      if (lateral.lengthSq() < 1e-8) lateral.set(1, 0, 0);

      const banking = bankingAt(u);
      const bankedLateral = lateral.clone().multiplyScalar(Math.cos(banking));
      bankedLateral.y += Math.sin(banking);
      bankedLateral.normalize();

      let normal = new THREE.Vector3().crossVectors(tangent, bankedLateral).normalize();
      if (normal.y < 0) normal.multiplyScalar(-1);

      if (previous) distance += previous.distanceTo(center);
      previous = center;
      this.samples.push({
        u,
        center,
        tangent,
        lateral,
        bankedLateral,
        normal,
        banking,
        distance,
      });
    }
  }

  public sampleAt(u: number): TrackSample {
    const wrapped = ((u % 1) + 1) % 1;
    const f = wrapped * PATH_SAMPLES;
    const i0 = Math.floor(f) % PATH_SAMPLES;
    const i1 = (i0 + 1) % PATH_SAMPLES;
    const k = f - Math.floor(f);
    const a = this.samples[i0];
    const b = this.samples[i1];

    const tangent = a.tangent.clone().lerp(b.tangent, k).normalize();
    const lateral = a.lateral.clone().lerp(b.lateral, k).normalize();
    const bankedLateral = a.bankedLateral.clone().lerp(b.bankedLateral, k).normalize();
    let normal = new THREE.Vector3().crossVectors(tangent, bankedLateral).normalize();
    if (normal.y < 0) normal.multiplyScalar(-1);

    return {
      u: wrapped,
      center: a.center.clone().lerp(b.center, k),
      tangent,
      lateral,
      bankedLateral,
      normal,
      banking: THREE.MathUtils.lerp(a.banking, b.banking, k),
      distance: THREE.MathUtils.lerp(a.distance, b.distance, k),
    };
  }

  public closest(x: number, z: number, elevationHint: number, lastU?: number): { sample: TrackSample; lateralOffset: number } {
    return selectShowcaseSample(this, x, z, elevationHint, lastU ?? this.spawnU());
  }

  public spawnU(): number {
    return SPAWN_U;
  }

  public spawn(): ShowcaseSpawn {
    const s = this.sampleAt(SPAWN_U);
    return {
      x: s.center.x,
      z: s.center.z,
      yaw: Math.atan2(s.tangent.x, s.tangent.z),
      elevation: s.center.y,
    };
  }
}

export function selectShowcaseSample(
  path: ShowcaseTrackPath,
  x: number,
  z: number,
  elevationHint: number,
  lastU: number
): { sample: TrackSample; lateralOffset: number } {
  const coarse: Array<{ index: number; d2: number }> = [];
  for (let i = 0; i < PATH_SAMPLES; i += 3) {
    const s = path.samples[i];
    const dx = x - s.center.x;
    const dz = z - s.center.z;
    coarse.push({ index: i, d2: dx * dx + dz * dz });
  }
  coarse.sort((a, b) => a.d2 - b.d2);
  const candidateIndices = new Set<number>();
  for (const c of coarse.slice(0, 8)) {
    for (let k = -6; k <= 6; k++) candidateIndices.add((c.index + k + PATH_SAMPLES) % PATH_SAMPLES);
  }
  const hint = Number.isFinite(elevationHint) ? elevationHint : path.spawn().elevation;
  const refU = Number.isFinite(lastU) ? lastU : SPAWN_U;
  let best = path.samples[0];
  let bestScore = Infinity;
  for (const index of candidateIndices) {
    const s = path.samples[index];
    const dx = x - s.center.x;
    const dz = z - s.center.z;
    const d2 = dx * dx + dz * dz;
    const elevationPenalty = Math.pow((s.center.y - hint) * 1.2, 2);
    const alongM = wrapTrackDeltaU(s.u, refU) * path.lengthM;
    const continuityPenalty = Math.pow(alongM * 0.35, 2);
    const score = d2 + elevationPenalty + continuityPenalty;
    if (score < bestScore) { bestScore = score; best = s; }
  }
  const dx = x - best.center.x;
  const dz = z - best.center.z;
  const lateralOffset = dx * best.lateral.x + dz * best.lateral.z;
  return { sample: best, lateralOffset };
}

export function estimateShowcaseMinRadius(path: ShowcaseTrackPath, steps = 360): { minRadiusM: number; meanRadiusM: number } {
  let min = Infinity;
  let sum = 0;
  for (let i = 0; i < steps; i++) {
    const a = path.sampleAt(i / steps);
    const b = path.sampleAt((i + 1) / steps);
    const ax = a.tangent.x; const az = a.tangent.z;
    const bx = b.tangent.x; const bz = b.tangent.z;
    const angle = Math.acos(Math.max(-1, Math.min(1, ax * bx + az * bz)));
    const dist = a.center.distanceTo(b.center);
    if (angle > 1e-5 && dist > 1e-6) {
      const r = dist / angle;
      min = Math.min(min, r);
      sum += r;
    }
  }
  return { minRadiusM: min, meanRadiusM: sum / steps };
}

const SHOWCASE_PATH = new ShowcaseTrackPath();

export class ShowcaseCircuitSurfaceProvider implements ISurfaceProvider {
  private elevationHint: number;
  private lastU: number;

  constructor(private readonly path: ShowcaseTrackPath = SHOWCASE_PATH) {
    this.elevationHint = path.spawn().elevation;
    this.lastU = path.spawnU();
  }

  public resetHint(elevation: number): void {
    if (Number.isFinite(elevation)) this.elevationHint = elevation;
    this.lastU = this.path.spawnU();
  }

  public resetHintTo(elevation: number, u: number): void {
    if (Number.isFinite(elevation)) this.elevationHint = elevation;
    if (Number.isFinite(u)) this.lastU = ((u % 1) + 1) % 1;
  }

  public getHint(): number { return this.elevationHint; }
  public getLastU(): number { return this.lastU; }

  public sampleSurfaceWithHint(x: number, z: number, hintElevation: number, hintU: number): SurfaceSample {
    const savedHint = this.elevationHint;
    const savedU = this.lastU;
    this.elevationHint = hintElevation;
    this.lastU = hintU;
    const out = this.sampleSurfaceNoCommit(x, z);
    this.elevationHint = savedHint;
    this.lastU = savedU;
    return out;
  }

  private sampleSurfaceNoCommit(x: number, z: number): SurfaceSample {
    const hit = selectShowcaseSample(this.path, x, z, this.elevationHint, this.lastU);
    const s = hit.sample;
    const lateral = hit.lateralOffset;
    const absLateral = Math.abs(lateral);
    const roadPoint = s.center.clone().addScaledVector(s.bankedLateral, lateral);
    const slopePitch = Math.atan2(s.tangent.y, Math.max(1e-6, Math.hypot(s.tangent.x, s.tangent.z)));

    const sample = (
      elevation: number,
      type: SurfaceSample['type'],
      friction: number,
      rollingResistance: number,
      isKerbRumble: boolean,
      normal: THREE.Vector3 = s.normal,
    ): SurfaceSample => ({
      elevation,
      normal: { x: normal.x, y: normal.y, z: normal.z },
      slopePitch,
      slopeRoll: s.banking,
      type,
      friction,
      rollingResistance,
      wetness: 0,
      isKerbRumble,
    });

    if (absLateral <= TRACK_HALF_WIDTH_M) {
      return sample(roadPoint.y, absLateral < 3.4 ? 'racing_line' : 'asphalt', 1.08, 0.016, false);
    }

    if (absLateral <= TRACK_HALF_WIDTH_M + CURB_WIDTH_M) {
      return sample(roadPoint.y + 0.025, 'kerb', 0.88, 0.024, true);
    }

    if (absLateral <= TRACK_HALF_WIDTH_M + RUNOFF_WIDTH_M) {
      const runoffDrop = Math.min(0.35, (absLateral - TRACK_HALF_WIDTH_M) * 0.018);
      return sample(roadPoint.y - runoffDrop, 'marbles', 0.72, 0.038, false);
    }

    if (absLateral <= TRACK_HALF_WIDTH_M + RUNOFF_WIDTH_M + RUNOFF_BLEND_M) {
      const edgeElev = roadPoint.y - 0.35;
      const t = (absLateral - TRACK_HALF_WIDTH_M - RUNOFF_WIDTH_M) / RUNOFF_BLEND_M;
      const elevation = edgeElev + (0 - edgeElev) * t * t * (3 - 2 * t);
      return sample(elevation, 'gravel', 0.52, 0.08, false, new THREE.Vector3(0, 1, 0));
    }
    return {
      elevation: 0,
      normal: { x: 0, y: 1, z: 0 },
      slopePitch: 0,
      slopeRoll: 0,
      type: 'gravel',
      friction: 0.52,
      rollingResistance: 0.08,
      wetness: 0,
      isKerbRumble: false,
    };
  }

  public sampleSurface(x: number, z: number): SurfaceSample {
    const hintSnapshot = this.elevationHint;
    const lastUSnapshot = this.lastU;
    const hit = selectShowcaseSample(this.path, x, z, hintSnapshot, lastUSnapshot);
    const absLateral = Math.abs(hit.lateralOffset);
    const out = this.sampleSurfaceNoCommit(x, z);
    // Rate-limited commit only for engineered shelf. All 4 wheels in one frame
    // share nearly identical snapshots, so they select the same deck. A 12 m deck
    // jump needs ~20 queries to migrate, while true grades (<0.1 m per query)
    // track immediately. Off-shelf queries never drag the hint.
    if (absLateral <= TRACK_HALF_WIDTH_M + RUNOFF_WIDTH_M) {
      const s = hit.sample;
      const roadY = s.center.clone().addScaledVector(s.bankedLateral, hit.lateralOffset).y;
      const runoffDrop = absLateral <= TRACK_HALF_WIDTH_M ? 0 : Math.min(0.35, (absLateral - TRACK_HALF_WIDTH_M) * 0.018);
      const targetY = roadY - runoffDrop;
      const delta = targetY - this.elevationHint;
      this.elevationHint += THREE.MathUtils.clamp(delta, -MAX_HINT_STEP_M, MAX_HINT_STEP_M);
      this.lastU = hit.sample.u;
    }
    return out;
  }
}

function buildRibbon(path: ShowcaseTrackPath, width: number, verticalOffset = 0, segments = 540): THREE.BufferGeometry {
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const half = width / 2;

  for (let i = 0; i <= segments; i++) {
    const s = path.sampleAt(i / segments);
    const left = s.center.clone().addScaledVector(s.bankedLateral, half).addScaledVector(s.normal, verticalOffset);
    const right = s.center.clone().addScaledVector(s.bankedLateral, -half).addScaledVector(s.normal, verticalOffset);
    positions.push(left.x, left.y, left.z, right.x, right.y, right.z);
    uvs.push(0, i / 8, 1, i / 8);
    if (i < segments) {
      const a = i * 2;
      indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function seededRandomFactory(seed = 0x51f15e): () => number {
  let value = seed >>> 0;
  return () => {
    value = (Math.imul(value, 1664525) + 1013904223) >>> 0;
    return value / 0x100000000;
  };
}

function makeNumberBoardTexture(text: string): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#f8fafc';
  ctx.fillRect(0, 0, 128, 128);
  ctx.strokeStyle = '#111827';
  ctx.lineWidth = 8;
  ctx.strokeRect(4, 4, 120, 120);
  ctx.fillStyle = '#111827';
  ctx.font = '900 54px system-ui';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 64, 66);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function addGantry(group: THREE.Group, sample: TrackSample, materials: THREE.Material[]): void {
  const gantry = new THREE.Group();
  const metal = new THREE.MeshStandardMaterial({ color: 0x202a35, metalness: 0.75, roughness: 0.35 });
  const bannerMat = new THREE.MeshStandardMaterial({ color: 0x0ea5e9, emissive: 0x073b55, emissiveIntensity: 0.55, roughness: 0.45 });
  materials.push(metal, bannerMat);
  const pillarGeo = new THREE.BoxGeometry(0.55, 7.4, 0.55);
  const span = TRACK_HALF_WIDTH_M + 2.2;
  for (const side of [-1, 1]) {
    const pillar = new THREE.Mesh(pillarGeo, metal);
    pillar.position.set(side * span, 3.7, 0);
    pillar.castShadow = true;
    gantry.add(pillar);
  }
  const beam = new THREE.Mesh(new THREE.BoxGeometry(span * 2 + 0.7, 0.55, 0.7), metal);
  beam.position.y = 7.1;
  gantry.add(beam);
  const banner = new THREE.Mesh(new THREE.BoxGeometry(TRACK_WIDTH_M * 0.72, 1.55, 0.28), bannerMat);
  banner.position.y = 6.05;
  gantry.add(banner);
  const yaw = Math.atan2(sample.tangent.x, sample.tangent.z);
  gantry.position.copy(sample.center);
  gantry.rotation.y = yaw;
  group.add(gantry);
}

function buildCircuitGroup(path: ShowcaseTrackPath): THREE.Group {
  const group = new THREE.Group();
  group.name = 'muse-showcase-circuit';
  const materials: THREE.Material[] = [];

  const hemi = new THREE.HemisphereLight(0xd9f0ff, 0x24301f, 1.05);
  const sun = new THREE.DirectionalLight(0xfff2cf, 2.05);
  sun.position.set(TRACK_CENTER_X + 180, 220, -120);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -260;
  sun.shadow.camera.right = 260;
  sun.shadow.camera.top = 260;
  sun.shadow.camera.bottom = -260;
  sun.shadow.camera.near = 20;
  sun.shadow.camera.far = 600;
  group.add(hemi, sun);

  const terrainMat = new THREE.MeshStandardMaterial({ color: 0x586947, roughness: 1 });
  const shelfMat = new THREE.MeshStandardMaterial({ color: 0x6b6654, roughness: 1 });
  const runoffMat = new THREE.MeshStandardMaterial({ color: 0x50565a, roughness: 0.98 });
  const edgeMat = new THREE.MeshStandardMaterial({ color: 0xe8edf2, roughness: 0.78 });
  const asphaltMat = new THREE.MeshStandardMaterial({ color: 0x171b21, roughness: 0.9, metalness: 0.05 });
  const concreteMat = new THREE.MeshStandardMaterial({ color: 0x8b949d, roughness: 0.83 });
  const darkMetalMat = new THREE.MeshStandardMaterial({ color: 0x303942, metalness: 0.62, roughness: 0.46 });
  const redMat = new THREE.MeshStandardMaterial({ color: 0xd92d20, roughness: 0.6 });
  const whiteMat = new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.55 });
  const rockMat = new THREE.MeshStandardMaterial({ color: 0x645a4b, roughness: 1 });
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x4b3828, roughness: 1 });
  const foliageMat = new THREE.MeshStandardMaterial({ color: 0x244b2e, roughness: 1 });
  materials.push(terrainMat, shelfMat, runoffMat, edgeMat, asphaltMat, concreteMat, darkMetalMat, redMat, whiteMat, rockMat, trunkMat, foliageMat);

  const terrain = new THREE.Mesh(new THREE.PlaneGeometry(1120, 940), terrainMat);
  terrain.rotation.x = -Math.PI / 2;
  terrain.position.set(TRACK_CENTER_X, -0.08, 0);
  terrain.receiveShadow = true;
  group.add(terrain);

  const shelf = new THREE.Mesh(buildRibbon(path, 48, -0.25), shelfMat);
  const runoff = new THREE.Mesh(buildRibbon(path, TRACK_WIDTH_M + 20, -0.08), runoffMat);
  const edge = new THREE.Mesh(buildRibbon(path, TRACK_WIDTH_M + 1.0, 0.012), edgeMat);
  const road = new THREE.Mesh(buildRibbon(path, TRACK_WIDTH_M, 0.026), asphaltMat);
  for (const mesh of [shelf, runoff, edge, road]) {
    mesh.receiveShadow = true;
    group.add(mesh);
  }

  // Start/finish checkerboard.
  const start = path.sampleAt(0.012);
  const checker = document.createElement('canvas');
  checker.width = 128;
  checker.height = 32;
  const checkerCtx = checker.getContext('2d')!;
  for (let x = 0; x < 16; x++) for (let y = 0; y < 4; y++) {
    checkerCtx.fillStyle = (x + y) % 2 ? '#111827' : '#f8fafc';
    checkerCtx.fillRect(x * 8, y * 8, 8, 8);
  }
  const checkerTexture = new THREE.CanvasTexture(checker);
  const checkerMat = new THREE.MeshBasicMaterial({ map: checkerTexture, side: THREE.DoubleSide });
  materials.push(checkerMat);
  const line = new THREE.Mesh(new THREE.PlaneGeometry(TRACK_WIDTH_M, 2.8), checkerMat);
  line.geometry.rotateX(-Math.PI / 2);
  line.position.copy(start.center).addScaledVector(start.normal, 0.055);
  line.rotation.y = Math.atan2(start.tangent.x, start.tangent.z);
  group.add(line);

  // Alternating curbs and continuous guardrails are batched with instancing.
  const curbGeo = new THREE.BoxGeometry(1.25, 0.10, 4.6);
  const barrierGeo = new THREE.BoxGeometry(0.42, 1.05, 6.2);
  const curbSamples = 180;
  const redCurbs = new THREE.InstancedMesh(curbGeo, redMat, curbSamples * 2);
  const whiteCurbs = new THREE.InstancedMesh(curbGeo, whiteMat, curbSamples * 2);
  const barriers = new THREE.InstancedMesh(barrierGeo, concreteMat, curbSamples * 2);
  const matrix = new THREE.Matrix4();
  const quat = new THREE.Quaternion();
  const scale = new THREE.Vector3(1, 1, 1);
  const euler = new THREE.Euler();
  let redIndex = 0;
  let whiteIndex = 0;
  let barrierIndex = 0;

  for (let i = 0; i < curbSamples; i++) {
    const s = path.sampleAt(i / curbSamples);
    const yaw = Math.atan2(s.tangent.x, s.tangent.z);
    euler.set(0, yaw, 0);
    quat.setFromEuler(euler);
    for (const side of [-1, 1]) {
      const curbPos = s.center.clone().addScaledVector(s.bankedLateral, side * (TRACK_HALF_WIDTH_M + 0.62)).addScaledVector(s.normal, 0.06);
      matrix.compose(curbPos, quat, scale);
      if ((i + (side > 0 ? 0 : 1)) % 2 === 0) redCurbs.setMatrixAt(redIndex++, matrix);
      else whiteCurbs.setMatrixAt(whiteIndex++, matrix);

      const barrierPos = s.center.clone().addScaledVector(s.bankedLateral, side * (TRACK_HALF_WIDTH_M + 5.0));
      barrierPos.y += 0.53;
      matrix.compose(barrierPos, quat, scale);
      barriers.setMatrixAt(barrierIndex++, matrix);
    }
  }
  redCurbs.count = redIndex;
  whiteCurbs.count = whiteIndex;
  barriers.count = barrierIndex;
  redCurbs.instanceMatrix.needsUpdate = true;
  whiteCurbs.instanceMatrix.needsUpdate = true;
  barriers.instanceMatrix.needsUpdate = true;
  barriers.castShadow = true;
  group.add(redCurbs, whiteCurbs, barriers);

  // Main gantry plus two sector gantries.
  addGantry(group, path.sampleAt(0.012), materials);
  addGantry(group, path.sampleAt(0.34), materials);
  addGantry(group, path.sampleAt(0.68), materials);

  // Pit lane and paddock read clearly from the opening straight.
  const pit = new THREE.Mesh(new THREE.BoxGeometry(7.5, 0.09, 155), asphaltMat);
  pit.position.set(TRACK_CENTER_X + 25, 2.0, -255);
  pit.receiveShadow = true;
  group.add(pit);
  const pitWall = new THREE.Mesh(new THREE.BoxGeometry(0.55, 1.15, 160), concreteMat);
  pitWall.position.set(TRACK_CENTER_X + 17.5, 2.55, -255);
  group.add(pitWall);
  const paddock = new THREE.Mesh(new THREE.BoxGeometry(42, 10, 105), darkMetalMat);
  paddock.position.set(TRACK_CENTER_X + 55, 5, -255);
  paddock.castShadow = true;
  group.add(paddock);
  const paddockRoof = new THREE.Mesh(new THREE.BoxGeometry(46, 1.0, 110), redMat);
  paddockRoof.position.set(TRACK_CENTER_X + 55, 10.4, -255);
  group.add(paddockRoof);

  // Stepped grandstands opposite pit lane.
  for (let row = 0; row < 5; row++) {
    const stand = new THREE.Mesh(new THREE.BoxGeometry(70, 1.2, 7), concreteMat);
    stand.position.set(TRACK_CENTER_X - 32 - row * 1.6, 0.7 + row * 1.35, -250 + row * 3.4);
    stand.castShadow = true;
    group.add(stand);
  }
  const standRoof = new THREE.Mesh(new THREE.BoxGeometry(78, 0.7, 24), darkMetalMat);
  standRoof.position.set(TRACK_CENTER_X - 38, 9.5, -238);
  standRoof.rotation.z = -0.08;
  group.add(standRoof);

  // Braking boards into the banked bowl/hairpin sequence.
  for (const [label, u] of [['150', 0.165], ['100', 0.18], ['50', 0.195]] as const) {
    const s = path.sampleAt(u);
    const texture = makeNumberBoardTexture(label);
    const mat = new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide });
    materials.push(mat);
    const board = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 2.4), mat);
    board.position.copy(s.center).addScaledVector(s.lateral, -(TRACK_HALF_WIDTH_M + 7));
    board.position.y += 1.8;
    board.rotation.y = Math.atan2(s.tangent.x, s.tangent.z) + Math.PI / 2;
    group.add(board);
  }

  // Neon landmark at the heavy-braking hairpin.
  const landmarkSample = path.sampleAt(0.30);
  const towerMat = new THREE.MeshStandardMaterial({ color: 0x5233a8, metalness: 0.32, roughness: 0.46, emissive: 0x170b3d, emissiveIntensity: 0.7 });
  const ringMat = new THREE.MeshStandardMaterial({ color: 0x67e8f9, emissive: 0x0e7490, emissiveIntensity: 2.0, roughness: 0.22 });
  materials.push(towerMat, ringMat);
  const tower = new THREE.Mesh(new THREE.CylinderGeometry(3.2, 5.2, 46, 16), towerMat);
  tower.position.copy(landmarkSample.center).addScaledVector(landmarkSample.lateral, 42);
  tower.position.y = 23;
  tower.castShadow = true;
  group.add(tower);
  const halo = new THREE.Mesh(new THREE.TorusGeometry(11, 1.05, 12, 48), ringMat);
  halo.position.copy(tower.position);
  halo.position.y += 11;
  halo.rotation.x = Math.PI / 2.5;
  group.add(halo);

  // Covered tunnel / rock-cut sector.
  const tunnelBeamGeo = new THREE.BoxGeometry(TRACK_WIDTH_M + 8, 0.75, 2.0);
  const tunnelPostGeo = new THREE.BoxGeometry(0.8, 6.2, 2.0);
  for (let i = 0; i <= 18; i++) {
    const s = path.sampleAt(0.46 + i * 0.0032);
    const yaw = Math.atan2(s.tangent.x, s.tangent.z);
    const beam = new THREE.Mesh(tunnelBeamGeo, darkMetalMat);
    beam.position.copy(s.center);
    beam.position.y += 6.3;
    beam.rotation.y = yaw;
    group.add(beam);
    for (const side of [-1, 1]) {
      const post = new THREE.Mesh(tunnelPostGeo, rockMat);
      post.position.copy(s.center).addScaledVector(s.lateral, side * (TRACK_HALF_WIDTH_M + 3.5));
      post.position.y += 3.0;
      post.rotation.y = yaw;
      group.add(post);
    }
  }

  // Canyon walls around the high-elevation technical sector.
  const rockGeo = new THREE.DodecahedronGeometry(1, 0);
  const canyonRocks = new THREE.InstancedMesh(rockGeo, rockMat, 180);
  let canyonIndex = 0;
  const rng = seededRandomFactory();
  for (let i = 0; i < 90; i++) {
    const u = 0.49 + (i / 90) * 0.16;
    const s = path.sampleAt(u);
    for (const side of [-1, 1]) {
      const p = s.center.clone().addScaledVector(s.lateral, side * (TRACK_HALF_WIDTH_M + 10 + rng() * 9));
      const size = 4 + rng() * 8;
      p.y += size * 0.35;
      matrix.compose(p, new THREE.Quaternion().setFromEuler(new THREE.Euler(rng() * 0.4, rng() * Math.PI, rng() * 0.3)), new THREE.Vector3(size, size * (1.2 + rng()), size));
      canyonRocks.setMatrixAt(canyonIndex++, matrix);
    }
  }
  canyonRocks.count = canyonIndex;
  canyonRocks.instanceMatrix.needsUpdate = true;
  canyonRocks.castShadow = true;
  group.add(canyonRocks);

  // Bridge supports beneath the elevated return that crosses the main straight.
  const supportGeo = new THREE.CylinderGeometry(1.5, 2.1, 1, 10);
  const supports = new THREE.InstancedMesh(supportGeo, concreteMat, 45);
  let supportIndex = 0;
  for (let i = 0; i < PATH_SAMPLES && supportIndex < 45; i += 5) {
    const s = path.samples[i];
    if (s.center.y < 8 || s.center.z < -270 || s.center.z > -170) continue;
    const height = Math.max(2, s.center.y);
    matrix.compose(
      new THREE.Vector3(s.center.x, height / 2, s.center.z),
      new THREE.Quaternion(),
      new THREE.Vector3(1, height, 1),
    );
    supports.setMatrixAt(supportIndex++, matrix);
  }
  supports.count = supportIndex;
  supports.instanceMatrix.needsUpdate = true;
  group.add(supports);

  // Sparse deterministic forest; route-relative placement keeps navigation landmarks readable.
  const trunkGeo = new THREE.CylinderGeometry(0.18, 0.28, 3.6, 6);
  const crownGeo = new THREE.ConeGeometry(1.8, 5.4, 7);
  const treeCount = 180;
  const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, treeCount);
  const crowns = new THREE.InstancedMesh(crownGeo, foliageMat, treeCount);
  for (let i = 0; i < treeCount; i++) {
    const s = path.sampleAt((i / treeCount + rng() * 0.008) % 1);
    const side = i % 2 === 0 ? 1 : -1;
    const offset = TRACK_HALF_WIDTH_M + 24 + rng() * 55;
    const p = s.center.clone().addScaledVector(s.lateral, side * offset);
    const baseY = Math.max(0, Math.min(s.center.y - 0.4, 8));
    matrix.compose(new THREE.Vector3(p.x, baseY + 1.8, p.z), new THREE.Quaternion(), new THREE.Vector3(1, 1, 1));
    trunks.setMatrixAt(i, matrix);
    matrix.compose(new THREE.Vector3(p.x, baseY + 5.1, p.z), new THREE.Quaternion(), new THREE.Vector3(1, 1, 1));
    crowns.setMatrixAt(i, matrix);
  }
  trunks.instanceMatrix.needsUpdate = true;
  crowns.instanceMatrix.needsUpdate = true;
  group.add(trunks, crowns);

  // Distant mountain silhouettes close the horizon without expensive terrain tessellation.
  const mountainGeo = new THREE.ConeGeometry(1, 1, 7);
  const mountainMat = new THREE.MeshStandardMaterial({ color: 0x4f5960, roughness: 1 });
  materials.push(mountainMat);
  const mountains = new THREE.InstancedMesh(mountainGeo, mountainMat, 22);
  for (let i = 0; i < 22; i++) {
    const angle = (i / 22) * Math.PI * 2;
    const radius = 510 + rng() * 120;
    const height = 95 + rng() * 120;
    const radiusScale = 55 + rng() * 70;
    matrix.compose(
      new THREE.Vector3(TRACK_CENTER_X + Math.cos(angle) * radius, height / 2 - 5, Math.sin(angle) * radius),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rng() * Math.PI, 0)),
      new THREE.Vector3(radiusScale, height, radiusScale),
    );
    mountains.setMatrixAt(i, matrix);
  }
  mountains.instanceMatrix.needsUpdate = true;
  group.add(mountains);

  // Store explicitly created material list for deterministic cleanup.
  group.userData.showcaseMaterials = materials;
  return group;
}

function disposeGroup(group: THREE.Group): void {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();

  group.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    if (object.geometry) geometries.add(object.geometry);
    const meshMaterials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of meshMaterials) {
      if (!material) continue;
      materials.add(material);
      const record = material as THREE.Material & Record<string, unknown>;
      for (const key of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap']) {
        const texture = record[key];
        if (texture instanceof THREE.Texture) textures.add(texture);
      }
    }
  });

  geometries.forEach((geometry) => geometry.dispose());
  textures.forEach((texture) => texture.dispose());
  materials.forEach((material) => material.dispose());
}

export function createShowcaseCircuit(scene: THREE.Scene): ShowcaseCircuitRuntime {
  const group = buildCircuitGroup(SHOWCASE_PATH);
  const surfaceProvider = new ShowcaseCircuitSurfaceProvider(SHOWCASE_PATH);
  const spawn = SHOWCASE_PATH.spawn();
  surfaceProvider.resetHint(spawn.elevation);
  scene.add(group);

  return {
    group,
    surfaceProvider,
    spawn,
    dispose: () => {
      scene.remove(group);
      disposeGroup(group);
    },
  };
}

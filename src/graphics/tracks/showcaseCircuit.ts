import * as THREE from 'three';
import type { ISurfaceProvider, SurfaceSample } from '../../physics/SurfaceProvider';
import { buildVenueLife } from './showcase/venueLife';

export const TRACK_CENTER_X = 560;
export const TRACK_WIDTH_M = 20;
export const TRACK_HALF_WIDTH_M = TRACK_WIDTH_M / 2;
export const CURB_WIDTH_M = 1.25;
export const RUNOFF_WIDTH_M = 18;
export const OUTER_RUNOFF_M = TRACK_HALF_WIDTH_M + CURB_WIDTH_M + RUNOFF_WIDTH_M;
export const BARRIER_OFFSET_M = OUTER_RUNOFF_M + 2.5;
export const TERRAIN_BERM_HALF_WIDTH_M = 82;
export const PATH_SAMPLES = 900;
export const SHOWCASE_SPAWN_U = 0.018;

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

export interface TrackSample {
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

export function bankingAt(u: number): number {
  // Deliberately progressive. The original circuit used ~14 degree banking with
  // high-frequency sign changes; that twisted the ribbon and made the heavy M5
  // react to the road instead of the driver. This keeps the spectacle while
  // limiting both amplitude and transition rate.
  const bowl = 0.09 * gaussian(u, 0.20, 0.09);
  const crest = 0.035 * gaussian(u, 0.40, 0.075);
  const technical = -0.055 * gaussian(u, 0.66, 0.075);
  const essesWindow = gaussian(u, 0.80, 0.13);
  const esses = Math.sin((u - 0.72) * Math.PI * 4) * 0.025 * essesWindow;
  return bowl + crest + technical + esses;
}

/**
 * Measured, non-self-crossing GP layout.
 *
 * The previous generated loop closed through a Catmull-Rom cusp and also crossed
 * itself, making wheel-by-wheel surface lookup ambiguous. This layout is purposely
 * simpler in topology but still has a long straight, fast bowl, high crest, flowing
 * north sector and a real slow technical corner on the southwest return.
 *
 * Dense numerical QA is enforced separately in showcaseCircuitQA.ts.
 */
export class ShowcaseTrackPath {
  public readonly curve: THREE.CatmullRomCurve3;
  public readonly samples: TrackSample[] = [];
  public readonly lengthM: number;

  constructor() {
    const raw: Array<[number, number, number]> = [
      [-120, 2, -420],
      [120, 2, -420],
      [260, 4, -380],
      [360, 7, -270],
      [400, 11, -120],
      [410, 15, 40],
      [350, 20, 180],
      [290, 24, 260],
      [280, 27, 340],
      [180, 29, 420],
      [30, 30, 440],
      [-130, 28, 420],
      [-280, 23, 340],
      [-360, 17, 210],
      [-390, 12, 60],
      [-350, 8, -90],
      [-280, 5, -180],
      [-330, 3, -300],
      [-240, 2, -380],
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

  public closest(x: number, z: number): { sample: TrackSample; lateralOffset: number } {
    let coarseBest = 0;
    let coarseDistance = Infinity;

    for (let i = 0; i < PATH_SAMPLES; i += 5) {
      const s = this.samples[i];
      const dx = x - s.center.x;
      const dz = z - s.center.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < coarseDistance) {
        coarseDistance = d2;
        coarseBest = i;
      }
    }

    let best = this.samples[coarseBest];
    let bestDistance = Infinity;
    for (let k = -12; k <= 12; k++) {
      const index = (coarseBest + k + PATH_SAMPLES) % PATH_SAMPLES;
      const s = this.samples[index];
      const dx = x - s.center.x;
      const dz = z - s.center.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < bestDistance) {
        bestDistance = d2;
        best = s;
      }
    }

    const dx = x - best.center.x;
    const dz = z - best.center.z;
    const lateralOffset = dx * best.lateral.x + dz * best.lateral.z;
    return { sample: best, lateralOffset };
  }

  public spawn(): ShowcaseSpawn {
    const s = this.sampleAt(SHOWCASE_SPAWN_U);
    return {
      x: s.center.x,
      z: s.center.z,
      yaw: Math.atan2(s.tangent.x, s.tangent.z),
      elevation: s.center.y,
    };
  }
}

export const SHOWCASE_PATH = new ShowcaseTrackPath();

export function getShowcasePath(): ShowcaseTrackPath {
  return SHOWCASE_PATH;
}

export class ShowcaseCircuitSurfaceProvider implements ISurfaceProvider {
  // Kept only for App reset API compatibility and QA readback. The value does NOT
  // participate in deck selection. With a non-crossing loop, XZ lookup is pure and
  // wheel query order cannot change the result.
  private resetElevationHint: number;

  constructor(private readonly path: ShowcaseTrackPath = SHOWCASE_PATH) {
    this.resetElevationHint = path.spawn().elevation;
  }

  public resetHint(elevation: number): void {
    if (Number.isFinite(elevation)) this.resetElevationHint = elevation;
  }

  public getHint(): number {
    return this.resetElevationHint;
  }

  public sampleSurface(x: number, z: number): SurfaceSample {
    const hit = this.path.closest(x, z);
    const s = hit.sample;
    const lateral = hit.lateralOffset;
    const absLateral = Math.abs(lateral);
    const roadPoint = s.center.clone().addScaledVector(s.bankedLateral, lateral);
    const slopePitch = Math.atan2(
      s.tangent.y,
      Math.max(1e-6, Math.hypot(s.tangent.x, s.tangent.z)),
    );

    const makeSample = (
      elevation: number,
      type: SurfaceSample['type'],
      friction: number,
      rollingResistance: number,
      isKerbRumble: boolean,
      normal = s.normal,
      slopeRoll = s.banking,
    ): SurfaceSample => ({
      elevation,
      normal: { x: normal.x, y: normal.y, z: normal.z },
      slopePitch,
      slopeRoll,
      type,
      friction,
      rollingResistance,
      wetness: 0,
      isKerbRumble,
    });

    if (absLateral <= TRACK_HALF_WIDTH_M) {
      return makeSample(
        roadPoint.y,
        absLateral < 3.6 ? 'racing_line' : 'asphalt',
        1.08,
        0.016,
        false,
      );
    }

    if (absLateral <= TRACK_HALF_WIDTH_M + CURB_WIDTH_M) {
      // 15 mm kerb lip: enough for feedback, not enough to launch the car.
      return makeSample(roadPoint.y + 0.015, 'kerb', 0.90, 0.024, true);
    }

    if (absLateral <= OUTER_RUNOFF_M) {
      const beyondCurb = absLateral - TRACK_HALF_WIDTH_M - CURB_WIDTH_M;
      const t = THREE.MathUtils.clamp(beyondCurb / RUNOFF_WIDTH_M, 0, 1);
      const smooth = t * t * (3 - 2 * t);
      return makeSample(
        roadPoint.y + THREE.MathUtils.lerp(0.015, -0.35, smooth),
        'marbles',
        0.74,
        0.040,
        false,
      );
    }

    // Outside the recovery shelf, blend toward the world floor over a long berm.
    // This is beyond the visual barrier, but remains continuous if the player gets
    // there instead of reproducing the original 20 m invisible cliff.
    const blendDistance = TERRAIN_BERM_HALF_WIDTH_M - OUTER_RUNOFF_M;
    const t = THREE.MathUtils.clamp((absLateral - OUTER_RUNOFF_M) / Math.max(1, blendDistance), 0, 1);
    const smooth = t * t * (3 - 2 * t);
    const innerY = roadPoint.y - 0.35;
    const elevation = THREE.MathUtils.lerp(innerY, 0, smooth);
    return makeSample(
      elevation,
      'gravel',
      0.52,
      0.080,
      false,
      new THREE.Vector3(0, 1, 0),
      0,
    );
  }
}

function buildRibbon(
  path: ShowcaseTrackPath,
  width: number,
  verticalOffset = 0,
  segments = 640,
): THREE.BufferGeometry {
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const half = width / 2;

  for (let i = 0; i <= segments; i++) {
    const s = path.sampleAt(i / segments);
    const left = s.center
      .clone()
      .addScaledVector(s.bankedLateral, half)
      .addScaledVector(s.normal, verticalOffset);
    const right = s.center
      .clone()
      .addScaledVector(s.bankedLateral, -half)
      .addScaledVector(s.normal, verticalOffset);

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

function buildTerrainBerm(path: ShowcaseTrackPath, segments = 420): THREE.BufferGeometry {
  const laterals = [-TERRAIN_BERM_HALF_WIDTH_M, -54, -34, 0, 34, 54, TERRAIN_BERM_HALF_WIDTH_M];
  const positions: number[] = [];
  const indices: number[] = [];

  for (let i = 0; i <= segments; i++) {
    const s = path.sampleAt(i / segments);
    for (const lateral of laterals) {
      const abs = Math.abs(lateral);
      const x = s.center.x + s.lateral.x * lateral;
      const z = s.center.z + s.lateral.z * lateral;
      const roadY = s.center.y + s.bankedLateral.y * lateral - 0.42;
      let y = roadY;
      if (abs > 34) {
        const t = THREE.MathUtils.clamp((abs - 34) / (TERRAIN_BERM_HALF_WIDTH_M - 34), 0, 1);
        const smooth = t * t * (3 - 2 * t);
        y = THREE.MathUtils.lerp(roadY, 0, smooth);
      }
      positions.push(x, y, z);
    }
  }

  const columns = laterals.length;
  for (let i = 0; i < segments; i++) {
    for (let j = 0; j < columns - 1; j++) {
      const a = i * columns + j;
      const b = a + 1;
      const c = (i + 1) * columns + j;
      const d = c + 1;
      indices.push(a, b, c, b, d, c);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
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

function trackQuaternion(sample: TrackSample): THREE.Quaternion {
  const basis = new THREE.Matrix4().makeBasis(
    sample.bankedLateral,
    sample.normal,
    sample.tangent,
  );
  return new THREE.Quaternion().setFromRotationMatrix(basis);
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

function addTrackAlignedBox(
  group: THREE.Group,
  sample: TrackSample,
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  lateralOffset: number,
  upOffset: number,
): THREE.Mesh {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position
    .copy(sample.center)
    .addScaledVector(sample.bankedLateral, lateralOffset)
    .addScaledVector(sample.normal, upOffset);
  mesh.quaternion.copy(trackQuaternion(sample));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);
  return mesh;
}

function addGantry(
  group: THREE.Group,
  sample: TrackSample,
  metal: THREE.Material,
  bannerMaterial: THREE.Material,
  labelWidth = 18,
): void {
  const supportOffset = BARRIER_OFFSET_M + 1.4;
  const pillarGeometry = new THREE.BoxGeometry(0.7, 8.2, 0.7);
  const beamGeometry = new THREE.BoxGeometry(supportOffset * 2 + 1.4, 0.7, 0.85);
  const bannerGeometry = new THREE.BoxGeometry(labelWidth, 1.7, 0.30);

  for (const side of [-1, 1]) {
    addTrackAlignedBox(group, sample, pillarGeometry, metal, side * supportOffset, 4.1);
  }
  addTrackAlignedBox(group, sample, beamGeometry, metal, 0, 8.0);
  addTrackAlignedBox(group, sample, bannerGeometry, bannerMaterial, 0, 6.8);
}

function buildCircuitGroup(path: ShowcaseTrackPath): THREE.Group {
  const group = new THREE.Group();
  group.name = 'muse-showcase-circuit-v2';

  const hemi = new THREE.HemisphereLight(0xdff4ff, 0x27321f, 1.0);
  const sun = new THREE.DirectionalLight(0xfff0cf, 1.9);
  sun.position.set(TRACK_CENTER_X + 180, 230, -150);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -320;
  sun.shadow.camera.right = 320;
  sun.shadow.camera.top = 320;
  sun.shadow.camera.bottom = -320;
  sun.shadow.camera.near = 20;
  sun.shadow.camera.far = 700;
  group.add(hemi, sun);

  const terrainMaterial = new THREE.MeshStandardMaterial({ color: 0x526044, roughness: 1 });
  const runoffMaterial = new THREE.MeshStandardMaterial({ color: 0x666b6f, roughness: 0.96 });
  const edgeMaterial = new THREE.MeshStandardMaterial({ color: 0xe5e7eb, roughness: 0.75 });
  const asphaltMaterial = new THREE.MeshStandardMaterial({ color: 0x171b20, roughness: 0.91, metalness: 0.04 });
  const concreteMaterial = new THREE.MeshStandardMaterial({ color: 0x929aa1, roughness: 0.82 });
  const metalMaterial = new THREE.MeshStandardMaterial({ color: 0x29333d, metalness: 0.67, roughness: 0.42 });
  const redMaterial = new THREE.MeshStandardMaterial({ color: 0xd62f2f, roughness: 0.58 });
  const whiteMaterial = new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.54 });
  const rockMaterial = new THREE.MeshStandardMaterial({ color: 0x665b4d, roughness: 1 });
  const trunkMaterial = new THREE.MeshStandardMaterial({ color: 0x4a3829, roughness: 1 });
  const foliageMaterial = new THREE.MeshStandardMaterial({ color: 0x244b2d, roughness: 1 });
  const cyanMaterial = new THREE.MeshStandardMaterial({
    color: 0x22d3ee,
    emissive: 0x075985,
    emissiveIntensity: 0.8,
    roughness: 0.35,
  });

  const worldFloor = new THREE.Mesh(new THREE.PlaneGeometry(1300, 1200), terrainMaterial);
  worldFloor.rotation.x = -Math.PI / 2;
  worldFloor.position.set(TRACK_CENTER_X, -0.12, 0);
  worldFloor.receiveShadow = true;
  group.add(worldFloor);

  const terrainBerm = new THREE.Mesh(buildTerrainBerm(path), terrainMaterial);
  terrainBerm.receiveShadow = true;
  group.add(terrainBerm);

  const runoffWidth = OUTER_RUNOFF_M * 2;
  const runoff = new THREE.Mesh(buildRibbon(path, runoffWidth, -0.035), runoffMaterial);
  const edge = new THREE.Mesh(buildRibbon(path, TRACK_WIDTH_M + 0.9, 0.006), edgeMaterial);
  const road = new THREE.Mesh(buildRibbon(path, TRACK_WIDTH_M, 0.024), asphaltMaterial);
  runoff.receiveShadow = true;
  edge.receiveShadow = true;
  road.receiveShadow = true;
  group.add(runoff, edge, road);

  // Start/finish checkerboard aligned to the actual banked road basis.
  const start = path.sampleAt(SHOWCASE_SPAWN_U);
  const checkerCanvas = document.createElement('canvas');
  checkerCanvas.width = 160;
  checkerCanvas.height = 32;
  const checkerContext = checkerCanvas.getContext('2d')!;
  for (let x = 0; x < 20; x++) {
    for (let y = 0; y < 4; y++) {
      checkerContext.fillStyle = (x + y) % 2 ? '#111827' : '#f8fafc';
      checkerContext.fillRect(x * 8, y * 8, 8, 8);
    }
  }
  const checkerTexture = new THREE.CanvasTexture(checkerCanvas);
  const checkerMaterial = new THREE.MeshBasicMaterial({ map: checkerTexture, side: THREE.DoubleSide });
  const startLine = new THREE.Mesh(new THREE.PlaneGeometry(TRACK_WIDTH_M, 3.0), checkerMaterial);
  startLine.geometry.rotateX(-Math.PI / 2);
  startLine.position.copy(start.center).addScaledVector(start.normal, 0.055);
  startLine.quaternion.copy(trackQuaternion(start));
  group.add(startLine);

  // Route-following curbs and barriers use the full bank/pitch basis, not only yaw.
  const stationCount = 220;
  const curbGeometry = new THREE.BoxGeometry(CURB_WIDTH_M, 0.09, 5.0);
  const barrierGeometry = new THREE.BoxGeometry(0.52, 1.05, 6.5);
  const redCurbs = new THREE.InstancedMesh(curbGeometry, redMaterial, stationCount * 2);
  const whiteCurbs = new THREE.InstancedMesh(curbGeometry, whiteMaterial, stationCount * 2);
  const barriers = new THREE.InstancedMesh(barrierGeometry, concreteMaterial, stationCount * 2);
  const matrix = new THREE.Matrix4();
  const scale = new THREE.Vector3(1, 1, 1);
  let redIndex = 0;
  let whiteIndex = 0;
  let barrierIndex = 0;

  for (let i = 0; i < stationCount; i++) {
    const s = path.sampleAt(i / stationCount);
    const quaternion = trackQuaternion(s);
    for (const side of [-1, 1]) {
      const curbPosition = s.center
        .clone()
        .addScaledVector(s.bankedLateral, side * (TRACK_HALF_WIDTH_M + CURB_WIDTH_M * 0.5))
        .addScaledVector(s.normal, 0.055);
      matrix.compose(curbPosition, quaternion, scale);
      if ((i + (side > 0 ? 0 : 1)) % 2 === 0) redCurbs.setMatrixAt(redIndex++, matrix);
      else whiteCurbs.setMatrixAt(whiteIndex++, matrix);

      const barrierPosition = s.center
        .clone()
        .addScaledVector(s.bankedLateral, side * BARRIER_OFFSET_M)
        .addScaledVector(s.normal, 0.53);
      matrix.compose(barrierPosition, quaternion, scale);
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

  addGantry(group, start, metalMaterial, cyanMaterial, 22);
  addGantry(group, path.sampleAt(0.36), metalMaterial, cyanMaterial, 16);

  // Start-straight pit/paddock and grandstand are anchored to the local basis.
  const pitSample = path.sampleAt(0.025);
  const pitLaneGeometry = new THREE.BoxGeometry(8.0, 0.10, 175);
  const pitWallGeometry = new THREE.BoxGeometry(0.55, 1.1, 180);
  const pitLaneOffset = -(OUTER_RUNOFF_M + 7.0);
  addTrackAlignedBox(group, pitSample, pitLaneGeometry, asphaltMaterial, pitLaneOffset, 0.02);
  addTrackAlignedBox(group, pitSample, pitWallGeometry, concreteMaterial, -(OUTER_RUNOFF_M + 2.0), 0.55);

  const paddockGeometry = new THREE.BoxGeometry(32, 10, 130);
  const paddock = addTrackAlignedBox(group, pitSample, paddockGeometry, metalMaterial, -(OUTER_RUNOFF_M + 28), 5.0);
  paddock.castShadow = true;
  const roofGeometry = new THREE.BoxGeometry(36, 0.8, 136);
  addTrackAlignedBox(group, pitSample, roofGeometry, redMaterial, -(OUTER_RUNOFF_M + 28), 10.4);

  const standSample = path.sampleAt(0.03);
  for (let row = 0; row < 5; row++) {
    const standGeometry = new THREE.BoxGeometry(72, 1.1, 6.8);
    addTrackAlignedBox(
      group,
      standSample,
      standGeometry,
      concreteMaterial,
      OUTER_RUNOFF_M + 12 + row * 1.6,
      0.6 + row * 1.25,
    );
  }

  // Braking boards before the southwest technical corner.
  for (const [label, u] of [['150', 0.78], ['100', 0.795], ['50', 0.81]] as const) {
    const s = path.sampleAt(u);
    const texture = makeNumberBoardTexture(label);
    const material = new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide });
    const board = new THREE.Mesh(new THREE.PlaneGeometry(2.5, 2.5), material);
    board.position
      .copy(s.center)
      .addScaledVector(s.lateral, -(BARRIER_OFFSET_M + 4.0));
    board.position.y += 2.0;
    board.rotation.y = Math.atan2(s.tangent.x, s.tangent.z) + Math.PI / 2;
    group.add(board);
  }

  // Summit landmark: spectacle remains, but its supports stay outside recovery space.
  const summit = path.sampleAt(0.43);
  const towerGeometry = new THREE.CylinderGeometry(3.0, 5.0, 44, 14);
  const tower = new THREE.Mesh(towerGeometry, metalMaterial);
  tower.position
    .copy(summit.center)
    .addScaledVector(summit.lateral, BARRIER_OFFSET_M + 20);
  tower.position.y += 22;
  tower.castShadow = true;
  group.add(tower);
  const halo = new THREE.Mesh(new THREE.TorusGeometry(10, 0.9, 12, 48), cyanMaterial);
  halo.position.copy(tower.position);
  halo.position.y += 10;
  halo.rotation.x = Math.PI / 2.5;
  group.add(halo);

  // Open rock-cut rather than tunnel posts inside the runoff.
  const rng = seededRandomFactory();
  const rockGeometry = new THREE.DodecahedronGeometry(1, 0);
  const rockCount = 120;
  const rocks = new THREE.InstancedMesh(rockGeometry, rockMaterial, rockCount);
  let rockIndex = 0;
  for (let i = 0; i < 60; i++) {
    const s = path.sampleAt(0.54 + (i / 60) * 0.16);
    for (const side of [-1, 1]) {
      const size = 3.5 + rng() * 5.0;
      const offset = BARRIER_OFFSET_M + 8 + rng() * 14;
      const position = s.center.clone().addScaledVector(s.lateral, side * offset);
      position.y += size * 0.35;
      const quaternion = new THREE.Quaternion().setFromEuler(
        new THREE.Euler(rng() * 0.25, rng() * Math.PI, rng() * 0.25),
      );
      matrix.compose(position, quaternion, new THREE.Vector3(size, size * (1.1 + rng() * 0.7), size));
      rocks.setMatrixAt(rockIndex++, matrix);
    }
  }
  rocks.count = rockIndex;
  rocks.instanceMatrix.needsUpdate = true;
  rocks.castShadow = true;
  group.add(rocks);

  // Sparse deterministic vegetation; every tree starts outside the barrier corridor.
  const treeCount = 120;
  const trunkGeometry = new THREE.CylinderGeometry(0.18, 0.28, 3.8, 6);
  const crownGeometry = new THREE.ConeGeometry(1.9, 5.8, 7);
  const trunks = new THREE.InstancedMesh(trunkGeometry, trunkMaterial, treeCount);
  const crowns = new THREE.InstancedMesh(crownGeometry, foliageMaterial, treeCount);

  for (let i = 0; i < treeCount; i++) {
    const s = path.sampleAt((i / treeCount + rng() * 0.006) % 1);
    const side = i % 2 === 0 ? 1 : -1;
    const offset = BARRIER_OFFSET_M + 18 + rng() * 28;
    const position = s.center.clone().addScaledVector(s.lateral, side * offset);
    const absOffset = Math.abs(offset);
    const roadY = s.center.y + s.bankedLateral.y * (side * offset) - 0.4;
    const terrainT = THREE.MathUtils.clamp((absOffset - 34) / (TERRAIN_BERM_HALF_WIDTH_M - 34), 0, 1);
    const terrainSmooth = terrainT * terrainT * (3 - 2 * terrainT);
    const baseY = THREE.MathUtils.lerp(roadY, 0, terrainSmooth);

    matrix.compose(
      new THREE.Vector3(position.x, baseY + 1.9, position.z),
      new THREE.Quaternion(),
      new THREE.Vector3(1, 1, 1),
    );
    trunks.setMatrixAt(i, matrix);
    matrix.compose(
      new THREE.Vector3(position.x, baseY + 5.4, position.z),
      new THREE.Quaternion(),
      new THREE.Vector3(1, 1, 1),
    );
    crowns.setMatrixAt(i, matrix);
  }
  trunks.instanceMatrix.needsUpdate = true;
  crowns.instanceMatrix.needsUpdate = true;
  group.add(trunks, crowns);

  // Distant mountains are intentionally beyond every local track corridor.
  const mountainGeometry = new THREE.ConeGeometry(1, 1, 7);
  const mountainMaterial = new THREE.MeshStandardMaterial({ color: 0x536069, roughness: 1 });
  const mountainCount = 20;
  const mountains = new THREE.InstancedMesh(mountainGeometry, mountainMaterial, mountainCount);
  for (let i = 0; i < mountainCount; i++) {
    const angle = (i / mountainCount) * Math.PI * 2;
    const radius = 610 + rng() * 100;
    const height = 100 + rng() * 110;
    const radiusScale = 60 + rng() * 65;
    matrix.compose(
      new THREE.Vector3(
        TRACK_CENTER_X + Math.cos(angle) * radius,
        height / 2 - 5,
        Math.sin(angle) * radius,
      ),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rng() * Math.PI, 0)),
      new THREE.Vector3(radiusScale, height, radiusScale),
    );
    mountains.setMatrixAt(i, matrix);
  }
  mountains.instanceMatrix.needsUpdate = true;
  group.add(mountains);

  // Premium venue dressing only. Control points, bankingAt(), widths,
  // surface logic and spawn above are untouched. All furniture stays
  // outside BARRIER_OFFSET_M so corridor + 18m runoff remain clear.
  buildVenueLife(group, path, BARRIER_OFFSET_M, OUTER_RUNOFF_M);

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

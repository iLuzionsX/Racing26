import * as THREE from 'three';
import type { ISurfaceProvider, SurfaceSample } from '../../physics/SurfaceProvider';

/**
 * Racing26 runtime port of the original iLuzionsX/racerrhi APEX / Côte d'Azur circuit.
 *
 * Source geometry is intentionally kept faithful to racerrhi:
 * - the same 13 closed Catmull-Rom control points
 * - the same 15 m asphalt ribbon
 * - the same 33 m gravel shelf
 * - the same kerb / edge-line offsets
 * - the same ±16 m continuous guardrail placement
 * - coastal terrain, ocean, ridgelines, pit buildings and track furniture
 *
 * The M5 physics itself remains Racing26. The surface provider below is derived from
 * the exact same path/width constants used to render the circuit so a crash cannot
 * put the tires on invisible low-grip terrain while the player still sees asphalt.
 */

export const TRACK_CENTER_X = 0;
export const TRACK_WIDTH_M = 15;
export const TRACK_HALF_WIDTH_M = TRACK_WIDTH_M / 2;
export const CURB_WIDTH_M = 0.9;
export const RUNOFF_WIDTH_M = 8.1;
export const OUTER_RUNOFF_M = 16.5;
export const BARRIER_OFFSET_M = 16;
export const TERRAIN_BERM_HALF_WIDTH_M = 68;
export const PATH_SAMPLES = 1400;
export const SHOWCASE_SPAWN_U = 0;
export const RACERRHI_RECOVERY_LIMIT_M = 14.5;

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

export function bankingAt(_u: number): number {
  return 0;
}

const RACERRHI_CONTROL_POINTS: ReadonlyArray<readonly [number, number, number]> = [
  [-225, 13, -200],
  [-225, 13, 50],
  [-185, 16, 245],
  [-55, 22, 325],
  [100, 27, 265],
  [155, 24, 115],
  [290, 22, 65],
  [300, 20, -65],
  [170, 18, -110],
  [85, 14, -225],
  [185, 11, -320],
  [70, 11, -385],
  [-110, 12, -345],
];

export class ShowcaseTrackPath {
  public readonly curve: THREE.CatmullRomCurve3;
  public readonly samples: TrackSample[] = [];
  public readonly lengthM: number;

  constructor() {
    this.curve = new THREE.CatmullRomCurve3(
      RACERRHI_CONTROL_POINTS.map(([x, y, z]) => new THREE.Vector3(x, y, z)),
      true,
      'centripetal',
    );
    this.curve.arcLengthDivisions = 4000;
    this.lengthM = this.curve.getLength();

    const worldUp = new THREE.Vector3(0, 1, 0);
    let distance = 0;
    let previous: THREE.Vector3 | null = null;

    for (let i = 0; i < PATH_SAMPLES; i++) {
      const u = i / PATH_SAMPLES;
      const center = this.curve.getPointAt(u);
      const tangent = this.curve.getTangentAt(u).normalize();
      const lateral = new THREE.Vector3(tangent.z, 0, -tangent.x).normalize();
      if (lateral.lengthSq() < 1e-8) lateral.copy(new THREE.Vector3(1, 0, 0));

      let normal = new THREE.Vector3().crossVectors(tangent, lateral).normalize();
      if (normal.dot(worldUp) < 0) normal.multiplyScalar(-1);

      if (previous) distance += previous.distanceTo(center);
      previous = center;
      this.samples.push({
        u,
        center,
        tangent,
        lateral,
        bankedLateral: lateral.clone(),
        normal,
        banking: 0,
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
    let normal = new THREE.Vector3().crossVectors(tangent, lateral).normalize();
    if (normal.y < 0) normal.multiplyScalar(-1);

    return {
      u: wrapped,
      center: a.center.clone().lerp(b.center, k),
      tangent,
      lateral,
      bankedLateral: lateral.clone(),
      normal,
      banking: 0,
      distance: THREE.MathUtils.lerp(a.distance, b.distance, k),
    };
  }

  public closest(x: number, z: number): { sample: TrackSample; lateralOffset: number; distance: number } {
    let coarseBest = 0;
    let coarseDistance = Infinity;

    for (let i = 0; i < PATH_SAMPLES; i += 6) {
      const s = this.samples[i];
      const dx = x - s.center.x;
      const dz = z - s.center.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < coarseDistance) {
        coarseDistance = d2;
        coarseBest = i;
      }
    }

    let bestSegment = coarseBest;
    let bestT = 0;
    let bestDistance = Infinity;

    for (let k = -18; k <= 18; k++) {
      const i0 = (coarseBest + k + PATH_SAMPLES) % PATH_SAMPLES;
      const i1 = (i0 + 1) % PATH_SAMPLES;
      const a = this.samples[i0];
      const b = this.samples[i1];
      const abx = b.center.x - a.center.x;
      const abz = b.center.z - a.center.z;
      const len2 = abx * abx + abz * abz;
      const t = len2 > 1e-10
        ? THREE.MathUtils.clamp(
            ((x - a.center.x) * abx + (z - a.center.z) * abz) / len2,
            0,
            1,
          )
        : 0;
      const qx = a.center.x + abx * t;
      const qz = a.center.z + abz * t;
      const dx = x - qx;
      const dz = z - qz;
      const d2 = dx * dx + dz * dz;
      if (d2 < bestDistance) {
        bestDistance = d2;
        bestSegment = i0;
        bestT = t;
      }
    }

    const u = ((bestSegment + bestT) / PATH_SAMPLES) % 1;
    const sample = this.sampleAt(u);
    const dx = x - sample.center.x;
    const dz = z - sample.center.z;
    const lateralOffset = dx * sample.lateral.x + dz * sample.lateral.z;
    return { sample, lateralOffset, distance: Math.hypot(dx, dz) };
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
    const absLateral = Math.abs(hit.lateralOffset);
    const horizontal = Math.max(1e-6, Math.hypot(s.tangent.x, s.tangent.z));
    const slopePitch = Math.atan2(s.tangent.y, horizontal);

    const make = (
      type: SurfaceSample['type'],
      friction: number,
      rollingResistance: number,
      isKerbRumble: boolean,
      elevation = s.center.y,
    ): SurfaceSample => ({
      elevation,
      normal: { x: s.normal.x, y: s.normal.y, z: s.normal.z },
      slopePitch,
      slopeRoll: 0,
      type,
      friction,
      rollingResistance,
      wetness: 0,
      isKerbRumble,
    });

    // Exact racerrhi semantics: the physical kerb overlaps the outer edge of the
    // 15 m road and is authoritative there. This ordering is deliberate.
    if (absLateral > 7.0 && absLateral <= 8.25) {
      return make('kerb', 0.88, 0.024, true);
    }

    if (absLateral <= TRACK_HALF_WIDTH_M) {
      return make('asphalt', 1.0, 0.015, false);
    }

    // Racerrhi rendered the gravel ribbon 90 mm low and the kerbs 45 mm high, but
    // its M5 bridge intentionally kept the *physics* contact deck continuous in Y.
    // Preserve that separation here: the material/friction changes are real while
    // the decorative offsets cannot inject a suspension impulse into the M5.
    //
    // Outside the shelf the player is on coastal terrain, which is legitimately low
    // grip. There are no invisible low-grip bands inside the visible asphalt.
    return make('gravel', 0.55, 0.075, false);
  }
}

function seededRandom(seed = 0x9e3779b9) {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function buildNoiseTexture(kind: 'road' | 'gravel'): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  const image = ctx.createImageData(256, 256);
  const rand = seededRandom(kind === 'road' ? 0xa11ce : 0x6a7e1);
  for (let i = 0; i < image.data.length; i += 4) {
    const n = rand();
    const base = kind === 'road' ? 71 + n * 34 : 130 + n * 52;
    image.data[i] = base;
    image.data[i + 1] = kind === 'road' ? base * 1.025 : base * 0.91;
    image.data[i + 2] = kind === 'road' ? base * 1.02 : base * 0.71;
    image.data[i + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(kind === 'road' ? 1 : 0.75, 28);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function buildRibbon(
  path: ShowcaseTrackPath,
  offset: number,
  width: number,
  material: THREE.Material,
  height = 0.02,
  colorCurbs = false,
): THREE.Mesh {
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const colors: number[] = [];

  for (let i = 0; i <= PATH_SAMPLES; i++) {
    const a = path.samples[i % PATH_SAMPLES];
    for (const side of [-1, 1]) {
      const p = a.center.clone().addScaledVector(a.lateral, offset + side * width / 2);
      positions.push(p.x, p.y + height, p.z);
      uvs.push(side === -1 ? 0 : width / 5, i * path.lengthM / PATH_SAMPLES / 5);
      if (colorCurbs) {
        const color = new THREE.Color(Math.floor(i * path.lengthM / PATH_SAMPLES / 4) % 2 ? '#ece7ce' : '#b53a25');
        colors.push(color.r, color.g, color.b);
      }
    }
    if (i < PATH_SAMPLES) {
      const j = i * 2;
      indices.push(j, j + 2, j + 1, j + 1, j + 2, j + 3);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  if (colorCurbs) geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();

  const effectiveMaterial = colorCurbs
    ? new THREE.MeshStandardMaterial({ color: '#ffffff', vertexColors: true, roughness: 0.82 })
    : material;
  const mesh = new THREE.Mesh(geometry, effectiveMaterial);
  mesh.receiveShadow = true;
  return mesh;
}

function buildContinuousRail(path: ShowcaseTrackPath, offset: number, height: number, material: THREE.Material) {
  const positions: number[] = [];
  const indices: number[] = [];
  for (let i = 0; i <= PATH_SAMPLES; i++) {
    const a = path.samples[i % PATH_SAMPLES];
    const p = a.center.clone().addScaledVector(a.lateral, offset);
    positions.push(p.x, p.y + height - 0.13, p.z, p.x, p.y + height + 0.13, p.z);
    if (i < PATH_SAMPLES) {
      const j = i * 2;
      indices.push(j, j + 1, j + 2, j + 1, j + 3, j + 2);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const railMaterial = (material as THREE.MeshStandardMaterial).clone();
  railMaterial.side = THREE.DoubleSide;
  const mesh = new THREE.Mesh(geometry, railMaterial);
  mesh.castShadow = mesh.receiveShadow = true;
  return mesh;
}

function groundHeight(path: ShowcaseTrackPath, x: number, z: number): number {
  const hit = path.closest(x, z);
  const base = hit.sample.center.y - 0.65;
  const dist = hit.distance;
  const blend = THREE.MathUtils.clamp((dist - 23) / 60, 0, 1);
  let y = base + (
    Math.sin(x * 0.019) * Math.cos(z * 0.023) * 4 +
    Math.sin(z * 0.047) * 1.2
  ) * blend;
  y += Math.pow(Math.max(0, (x - 310) / 400), 1.6) * 110;
  y -= Math.max(0, -x - 275) * 0.37;
  return Math.max(-12, y);
}

function buildCoastalTerrain(path: ShowcaseTrackPath, material: THREE.Material) {
  const geometry = new THREE.PlaneGeometry(1550, 1550, 110, 110);
  geometry.rotateX(-Math.PI / 2);
  const attr = geometry.attributes.position;
  const colors: number[] = [];
  const rand = seededRandom(0xc07eda);
  for (let i = 0; i < attr.count; i++) {
    const x = attr.getX(i);
    const z = attr.getZ(i);
    attr.setY(i, groundHeight(path, x, z));
    const c = new THREE.Color().setHSL(0.18 + rand() * 0.025, 0.16 + rand() * 0.12, 0.30 + rand() * 0.10);
    colors.push(c.r, c.g, c.b);
  }
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  const mat = (material as THREE.MeshStandardMaterial).clone();
  mat.vertexColors = true;
  const mesh = new THREE.Mesh(geometry, mat);
  mesh.receiveShadow = true;
  return mesh;
}

function makeSign(text: string, w = 10, h = 2, bg = '#172d28', fg = '#e3f0cf') {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, 1024, 256);
  ctx.fillStyle = fg;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '700 95px Arial';
  ctx.fillText(text, 512, 135, 940);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return new THREE.Mesh(
    new THREE.PlaneGeometry(w, h),
    new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide }),
  );
}

function trackObject(group: THREE.Group, path: ShowcaseTrackPath, u: number, offset: number, object: THREE.Object3D, lift = 0) {
  const a = path.sampleAt(u);
  object.position.copy(a.center).addScaledVector(a.lateral, offset);
  object.position.y += lift;
  object.rotation.y = Math.atan2(a.tangent.x, a.tangent.z);
  group.add(object);
  return object;
}

function addBox(
  group: THREE.Group,
  width: number,
  height: number,
  depth: number,
  material: THREE.Material,
  x: number,
  y: number,
  z: number,
  rotation = 0,
) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material);
  mesh.position.set(x, y, z);
  mesh.rotation.y = rotation;
  mesh.castShadow = mesh.receiveShadow = true;
  group.add(mesh);
  return mesh;
}

function buildForest(group: THREE.Group, path: ShowcaseTrackPath, material: THREE.Material) {
  const rand = seededRandom(0xf0e57);
  const placements: Array<{ x: number; y: number; z: number; s: number }> = [];
  for (let i = 0; i < 1700 && placements.length < 470; i++) {
    const x = -320 + rand() * 1050;
    const z = -690 + rand() * 1400;
    const hit = path.closest(x, z);
    const y = groundHeight(path, x, z);
    if (hit.distance < 24 || x < -280 || y < 2) continue;
    placements.push({ x, y, z, s: 4 + rand() * 6 });
  }

  const trunkGeo = new THREE.CylinderGeometry(0.12, 0.20, 1, 5);
  const crownGeo = new THREE.ConeGeometry(0.8, 2.4, 6);
  const trunks = new THREE.InstancedMesh(trunkGeo, new THREE.MeshStandardMaterial({ color: '#443a2c', roughness: 1 }), placements.length);
  const crowns = new THREE.InstancedMesh(crownGeo, material, placements.length);
  const dummy = new THREE.Object3D();

  placements.forEach((p, i) => {
    dummy.position.set(p.x, p.y + p.s * 0.8, p.z);
    dummy.scale.set(p.s * 0.15, p.s * 1.6, p.s * 0.15);
    dummy.rotation.set(0, i * 2.399, 0);
    dummy.updateMatrix();
    trunks.setMatrixAt(i, dummy.matrix);

    dummy.position.set(p.x, p.y + p.s * 2.1, p.z);
    dummy.scale.set(p.s * 0.46, p.s * 1.45, p.s * 0.46);
    dummy.updateMatrix();
    crowns.setMatrixAt(i, dummy.matrix);
  });

  trunks.castShadow = crowns.castShadow = true;
  group.add(trunks, crowns);
}

function buildCircuitGroup(path: ShowcaseTrackPath): THREE.Group {
  const group = new THREE.Group();
  group.name = 'racerrhi-apex-cote-d-azur';

  const terrainMat = new THREE.MeshStandardMaterial({ color: '#6c7950', roughness: 1 });
  const rockMat = new THREE.MeshStandardMaterial({ color: '#9b927a', roughness: 0.95 });
  const dark = new THREE.MeshStandardMaterial({ color: '#243331', roughness: 0.72 });
  const concrete = new THREE.MeshStandardMaterial({ color: '#b9b5a1', roughness: 0.9 });
  const metal = new THREE.MeshStandardMaterial({ color: '#aeb6ad', roughness: 0.4, metalness: 0.7 });
  const white = new THREE.MeshStandardMaterial({ color: '#e7e1c8', roughness: 0.86 });
  const red = new THREE.MeshStandardMaterial({ color: '#b84029', roughness: 0.8 });

  const roadTexture = buildNoiseTexture('road');
  const gravelTexture = buildNoiseTexture('gravel');
  const roadMat = new THREE.MeshStandardMaterial({ color: '#a2a7a4', roughness: 0.9, map: roadTexture });
  const gravelMat = new THREE.MeshStandardMaterial({ color: '#b6a68a', roughness: 1, map: gravelTexture });

  // Warm coastal sky copied from racerrhi's visual direction.
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    vertexShader: 'varying vec3 w; void main(){w=(modelMatrix*vec4(position,1.)).xyz; gl_Position=projectionMatrix*viewMatrix*vec4(w,1.);}',
    fragmentShader: `varying vec3 w; void main(){float h=normalize(w).y; vec3 horizon=vec3(.72,.70,.60); vec3 zenith=vec3(.20,.36,.43); vec3 c=mix(horizon,zenith,smoothstep(-.05,.75,h)); gl_FragColor=vec4(c,1.);}`,
  });
  group.add(new THREE.Mesh(new THREE.SphereGeometry(4000, 28, 14), skyMat));

  const hemi = new THREE.HemisphereLight('#dceeff', '#59684a', 0.8);
  const sun = new THREE.DirectionalLight('#ffdda1', 3);
  sun.position.set(-120, 180, -90);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.left = -55;
  sun.shadow.camera.right = 55;
  sun.shadow.camera.top = 55;
  sun.shadow.camera.bottom = -55;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 300;
  sun.shadow.bias = -0.00015;
  group.add(hemi, sun);

  group.add(buildRibbon(path, 0, 33, gravelMat, -0.09));
  group.add(buildRibbon(path, 0, 15, roadMat, 0.02));
  group.add(buildRibbon(path, -7.7, 0.9, white, 0.045, true));
  group.add(buildRibbon(path, 7.7, 0.9, white, 0.045, true));
  group.add(buildRibbon(path, -7.19, 0.13, white, 0.06));
  group.add(buildRibbon(path, 7.19, 0.13, white, 0.06));

  const rubber = new THREE.MeshStandardMaterial({ color: '#171c1a', transparent: true, opacity: 0.18, depthWrite: false, roughness: 1 });
  group.add(buildRibbon(path, -1.05, 0.6, rubber, 0.035));
  group.add(buildRibbon(path, 1.05, 0.6, rubber, 0.035));

  // Racerrhi's continuous double guardrail.
  for (const side of [-1, 1]) {
    group.add(buildContinuousRail(path, side * BARRIER_OFFSET_M, 0.65, metal));
    group.add(buildContinuousRail(path, side * BARRIER_OFFSET_M, 1.08, metal));

    const count = Math.floor(path.lengthM / 5);
    const posts = new THREE.InstancedMesh(new THREE.BoxGeometry(0.15, 1.3, 0.15), metal, count);
    const dummy = new THREE.Object3D();
    for (let i = 0; i < count; i++) {
      const a = path.sampleAt(i / count);
      dummy.position.copy(a.center).addScaledVector(a.lateral, side * BARRIER_OFFSET_M);
      dummy.position.y += 0.6;
      dummy.rotation.y = Math.atan2(a.tangent.x, a.tangent.z);
      dummy.updateMatrix();
      posts.setMatrixAt(i, dummy.matrix);
    }
    posts.castShadow = true;
    group.add(posts);
  }

  group.add(buildCoastalTerrain(path, terrainMat));

  const waterMat = new THREE.ShaderMaterial({
    transparent: false,
    vertexShader: 'varying vec3 w; void main(){w=(modelMatrix*vec4(position,1.)).xyz; gl_Position=projectionMatrix*viewMatrix*vec4(w,1.);}',
    fragmentShader: `varying vec3 w; void main(){float a=sin(w.x*.35)+sin(w.z*.29)+sin((w.x+w.z)*.7); vec3 c=vec3(.045,.24,.27)+a*.006; gl_FragColor=vec4(c,1.);}`,
  });
  const ocean = new THREE.Mesh(new THREE.PlaneGeometry(7000, 7000), waterMat);
  ocean.rotation.x = -Math.PI / 2;
  ocean.position.set(-1300, -2, 0);
  group.add(ocean);

  // Tall inland ridgelines from racerrhi.
  for (let j = 0; j < 8; j++) {
    const geometry = new THREE.PlaneGeometry(650, 600, 32, 32);
    geometry.rotateX(-Math.PI / 2);
    const attr = geometry.attributes.position;
    for (let i = 0; i < attr.count; i++) {
      const x = attr.getX(i);
      const z = attr.getZ(i);
      attr.setY(i, Math.max(0, 1 - Math.hypot(x / 340, z / 330)) * 230 + Math.sin(x * 0.032) * Math.cos(z * 0.037) * 13);
    }
    geometry.computeVertexNormals();
    const ridge = new THREE.Mesh(geometry, rockMat);
    ridge.position.set(650 + (j % 2) * 360, 0, -1200 + j * 350);
    ridge.receiveShadow = true;
    group.add(ridge);
  }

  buildForest(group, path, new THREE.MeshStandardMaterial({ color: '#314b35', roughness: 1 }));

  // Start gantry and grid.
  const start = path.sampleAt(0);
  for (const side of [-1, 1]) {
    trackObject(group, path, 0, side * 10, new THREE.Mesh(new THREE.BoxGeometry(0.5, 7, 0.5), dark), 3.5);
  }
  trackObject(group, path, 0, 0, new THREE.Mesh(new THREE.BoxGeometry(21, 2, 0.55), dark), 6.5);
  trackObject(group, path, 0.0004, 0, makeSign('APEX  /  CÔTE D’AZUR', 19, 1.4), 6.5);

  const yaw = Math.atan2(start.tangent.x, start.tangent.z);
  for (let a = 0; a < 16; a++) {
    for (let b = 0; b < 2; b++) {
      const material = a % 2 === b ? white : dark;
      const tile = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.9), material);
      const p = start.center.clone().addScaledVector(start.lateral, -7.2 + a * 0.9).addScaledVector(start.tangent, b * 0.9);
      tile.position.copy(p);
      tile.position.y += 0.06;
      tile.rotation.set(-Math.PI / 2, 0, -yaw);
      group.add(tile);
    }
  }

  // Pit buildings.
  for (let i = 0; i < 9; i++) {
    const u = 0.014 + i * 0.005;
    const a = path.sampleAt(u);
    const p = a.center.clone().addScaledVector(a.lateral, 28);
    const angle = Math.atan2(a.tangent.x, a.tangent.z);
    addBox(group, 15, 5.5, 9, concrete, p.x, p.y + 2.65, p.z, angle);
    addBox(group, 15.5, 0.25, 9.4, white, p.x, p.y + 5.6, p.z, angle);
    const glass = new THREE.MeshStandardMaterial({ color: '#254342', roughness: 0.15, metalness: 0.6 });
    addBox(group, 0.2, 1.5, 7, glass, p.x - 7.6 * a.lateral.x, p.y + 4.2, p.z - 7.6 * a.lateral.z, angle);
  }

  // Braking boards and coast banners.
  for (const baseU of [0.145, 0.30, 0.445, 0.61, 0.735, 0.845]) {
    for (let i = 0; i < 3; i++) {
      trackObject(group, path, baseU + i * 0.016, -11, makeSign(String(150 - i * 50), 1.3, 1.7, '#f0e9d4', '#152a27'), 1.3);
    }
    trackObject(group, path, baseU + 0.026, 16.2, makeSign('APEX  /  DRIVE THE COAST', 12, 1.1), 1.8);
  }

  // Compact grandstand.
  for (let i = 0; i < 10; i++) {
    const u = 0.09 + i * 0.006;
    const a = path.sampleAt(u);
    const p = a.center.clone().addScaledVector(a.lateral, 28);
    for (let j = 0; j < 5; j++) {
      addBox(
        group,
        2,
        0.7,
        9,
        j % 2 ? new THREE.MeshStandardMaterial({ color: '#b8bdae', roughness: 0.9 }) : dark,
        p.x + j * 1.25 * a.lateral.x,
        p.y + 0.8 + j * 0.75,
        p.z + j * 1.25 * a.lateral.z,
        Math.atan2(a.tangent.x, a.tangent.z),
      );
    }
  }

  // Tire wall from racerrhi's Riviera sector.
  const tireMaterial = new THREE.MeshStandardMaterial({ color: '#181b1e', roughness: 0.94 });
  const tireCount = 240;
  const tires = new THREE.InstancedMesh(new THREE.TorusGeometry(0.38, 0.17, 8, 16), tireMaterial, tireCount);
  const dummy = new THREE.Object3D();
  for (let i = 0; i < tireCount; i++) {
    const a = path.sampleAt(0.27 + Math.floor(i / 3) * 0.00082);
    dummy.position.copy(a.center).addScaledVector(a.lateral, -14.5);
    dummy.position.y += 0.22 + (i % 3) * 0.3;
    dummy.rotation.set(Math.PI / 2, 0, 0);
    dummy.updateMatrix();
    tires.setMatrixAt(i, dummy.matrix);
  }
  tires.castShadow = true;
  group.add(tires);

  return group;
}

function disposeGroup(group: THREE.Group): void {
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  group.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    const objectMaterials = mesh.material
      ? (Array.isArray(mesh.material) ? mesh.material : [mesh.material])
      : [];
    for (const material of objectMaterials) {
      materials.add(material);
      const candidate = material as THREE.Material & Record<string, unknown>;
      for (const key of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'alphaMap', 'emissiveMap']) {
        const value = candidate[key];
        if (value instanceof THREE.Texture) textures.add(value);
      }
    }
  });
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

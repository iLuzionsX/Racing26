import * as THREE from 'three';
/**
 * Showcase kerb ribbons - visual only.
 * Replaces the old 5m BoxGeometry Lego blocks with continuous banked-basis
 * ribbons that sit flush to asphalt/runoff.
 * No physics, centerline, banking, widths, SurfaceProvider, or spawn changes.
 * One shared <=256px neutral weathering map x vertex-color red/white blocks
 * keeps draw calls low (2 meshes sharing 1 material).
 */
export const SHOWCASE_KERB_TEXTURE_PX = 256;
export const SHOWCASE_KERB_RED_HEX = 0x9a463a;
export const SHOWCASE_KERB_WHITE_HEX = 0xd8d0bd;
export const SHOWCASE_KERB_BLOCK_M = 2.0;
export const SHOWCASE_KERB_STEPS_PER_BLOCK = 2;
export interface KerbPathLike {
  lengthM: number;
  sampleAt: (u: number) => { center: THREE.Vector3; bankedLateral: THREE.Vector3; normal: THREE.Vector3; };
}
export interface KerbRibbonOptions {
  trackHalfWidthM: number;
  curbWidthM: number;
  stepsPerBlock?: number;
  redHex?: number;
  whiteHex?: number;
  seed?: number;
}
function seededRandom(seed: number): () => number {
  let v = seed >>> 0;
  return () => { v = (Math.imul(v, 1664525) + 1013904223) >>> 0; return v / 0x100000000; };
}
/** Neutral concrete grain + inner-edge rubber + chips. Caller owns disposal. */
export function makeKerbWeatheringTexture(sizePx = SHOWCASE_KERB_TEXTURE_PX): THREE.CanvasTexture {
  const clamped = Math.min(SHOWCASE_KERB_TEXTURE_PX, Math.max(16, Math.round(sizePx)));
  const canvas = document.createElement('canvas');
  canvas.width = clamped;
  canvas.height = clamped;
  const ctx = canvas.getContext('2d')!;
  const rand = seededRandom(0x9e8b);
  ctx.fillStyle = '#bdbdbd';
  ctx.fillRect(0, 0, clamped, clamped);
  for (let i = 0; i < 5200; i++) {
    const g = 150 + Math.floor(rand() * 70);
    ctx.fillStyle = 'rgb(' + g + ',' + g + ',' + g + ')';
    ctx.fillRect(rand() * clamped, rand() * clamped, 1.6, 1.6);
  }
  for (let i = 0; i < 260; i++) {
    const x = rand() * clamped;
    const y = rand() * clamped;
    ctx.fillStyle = rand() > 0.5 ? 'rgba(70,70,72,0.28)' : 'rgba(225,225,220,0.26)';
    ctx.fillRect(x, y, 2.4 + rand() * 3.2, 1.2 + rand() * 1.6);
  }
  ctx.fillStyle = 'rgba(28,28,30,0.42)';
  for (let i = 0; i < 90; i++) {
    const y = rand() * clamped;
    const w = 8 + rand() * 30;
    const h = 1.5 + rand() * 3.5;
    const x = rand() * clamped * 0.22;
    ctx.fillRect(x, y, w, h);
  }
  ctx.fillStyle = 'rgba(40,40,42,0.20)';
  ctx.fillRect(0, 0, Math.floor(clamped * 0.10), clamped);
  ctx.fillStyle = 'rgba(60,60,62,0.16)';
  ctx.fillRect(Math.floor(clamped * 0.90), 0, clamped, clamped);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
function baseKerbColor(isRed: boolean, redHex: number, whiteHex: number, out: THREE.Color): THREE.Color {
  out.setHex(isRed ? redHex : whiteHex);
  return out;
}
const ASPHALT_BLEND = new THREE.Color(0x33373d);
const RUNOFF_BLEND = new THREE.Color(0x6d7276);
/** Pure geometry (no DOM) so headless QA can verify continuity. */
export function buildKerbRibbonGeometryForSide(path: KerbPathLike, side: 1 | -1, opts: KerbRibbonOptions): THREE.BufferGeometry {
  const trackHalf = opts.trackHalfWidthM;
  const curbWidth = opts.curbWidthM;
  const stepsPerBlock = opts.stepsPerBlock ?? SHOWCASE_KERB_STEPS_PER_BLOCK;
  const redHex = opts.redHex ?? SHOWCASE_KERB_RED_HEX;
  const whiteHex = opts.whiteHex ?? SHOWCASE_KERB_WHITE_HEX;
  const lengthM = Math.max(100, path.lengthM);
  let halfPeriods = Math.round(lengthM / SHOWCASE_KERB_BLOCK_M);
  if (halfPeriods % 2 === 1) halfPeriods += 1;
  halfPeriods = Math.max(8, halfPeriods);
  const segments = halfPeriods * Math.max(1, stepsPerBlock);
  const acrossFrac = [0, 0.33, 0.66, 1.0];
  const acrossLift = [0.026, 0.040, 0.036, 0.010];
  const acrossBlend = [0.20, 0.06, 0.08, 0.28];
  const cols = acrossFrac.length;
  const rows = segments + 1;
  const positions = new Float32Array(rows * cols * 3);
  const uvs = new Float32Array(rows * cols * 2);
  const colors = new Float32Array(rows * cols * 3);
  const rand = seededRandom((opts.seed ?? 0x51e) + (side > 0 ? 11 : 101));
  const rowShade = new Float32Array(rows);
  for (let i = 0; i < rows; i++) rowShade[i] = 0.94 + rand() * 0.12;
  const c = new THREE.Color();
  const tmp = new THREE.Vector3();
  for (let i = 0; i < rows; i++) {
    const u = (i % segments) / segments;
    const s = path.sampleAt(u);
    const vHalf = (i / segments) * halfPeriods;
    const isRed = Math.floor(vHalf + (side > 0 ? 0 : 1)) % 2 === 0;
    for (let j = 0; j < cols; j++) {
      const lateral = side * (trackHalf + acrossFrac[j] * curbWidth);
      tmp.copy(s.center).addScaledVector(s.bankedLateral, lateral).addScaledVector(s.normal, acrossLift[j]);
      const vi = (i * cols + j) * 3;
      positions[vi] = tmp.x; positions[vi + 1] = tmp.y; positions[vi + 2] = tmp.z;
      const ti = (i * cols + j) * 2;
      uvs[ti] = acrossFrac[j]; uvs[ti + 1] = vHalf;
      baseKerbColor(isRed, redHex, whiteHex, c);
      const blendTarget = j === 0 ? ASPHALT_BLEND : j === cols - 1 ? RUNOFF_BLEND : null;
      const blendAmt = acrossBlend[j];
      if (blendTarget) c.lerp(blendTarget, blendAmt);
      const shade = rowShade[i] * (j === 0 ? 0.90 : 1.0);
      colors[vi] = c.r * shade; colors[vi + 1] = c.g * shade; colors[vi + 2] = c.b * shade;
    }
  }
  const indices: number[] = [];
  for (let i = 0; i < segments; i++) {
    for (let j = 0; j < cols - 1; j++) {
      const a = i * cols + j;
      const b = a + 1;
      const cc = (i + 1) * cols + j;
      const d = cc + 1;
      indices.push(a, b, cc, b, d, cc);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return geo;
}
export interface KerbRibbonsResult { group: THREE.Group; material: THREE.MeshStandardMaterial; texture: THREE.CanvasTexture; }
/** Runtime builder: two meshes sharing one weathered material (2 draw calls). */
export function buildKerbRibbons(path: KerbPathLike, opts: KerbRibbonOptions): KerbRibbonsResult {
  const group = new THREE.Group();
  group.name = 'showcase-kerb-ribbons';
  const texture = makeKerbWeatheringTexture(SHOWCASE_KERB_TEXTURE_PX);
  const material = new THREE.MeshStandardMaterial({ map: texture, vertexColors: true, roughness: 0.92, metalness: 0.0 });
  for (const side of [1, -1] as const) {
    const geo = buildKerbRibbonGeometryForSide(path, side, opts);
    const mesh = new THREE.Mesh(geo, material);
    mesh.receiveShadow = true;
    mesh.castShadow = false;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    group.add(mesh);
  }
  return { group, material, texture };
}
export function isToyBrightKerbHex(hex: number): boolean {
  const r = ((hex >> 16) & 255) / 255;
  const g = ((hex >> 8) & 255) / 255;
  const b = (hex & 255) / 255;
  if (r > 0.80 && g < 0.30 && b < 0.30) return true;
  if (r > 0.94 && g > 0.94 && b > 0.94) return true;
  return false;
}

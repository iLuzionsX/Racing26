import * as THREE from 'three';
/**
 * Showcase surface materials - visual only.
 *
 * Procedural canvas detail layers for asphalt aggregate/rubbering,
 * seams/patches, grid boxes, edge wear, painted arrows, drainage
 * grates, pit concrete, barrier vs retaining-wall differentiation
 * and runoff speckle. No physics or road geometry changes.
 *
 * All canvas textures are <=256px and opaque-first to avoid
 * transparent overdraw. Real CC0 PBR textures can be swapped in
 * later via ShowcasePbrSource without changing call sites.
 * Not integrated yet: exports builder APIs for a later integrator.
 */
export const SHOWCASE_MAX_TEXTURE_PX = 256;
export const SHOWCASE_OPAQUE_FIRST = true;
/** Future CC0 PBR swap slot. Null fields keep procedural fallback. */
export interface ShowcasePbrSource {
  mapUrl?: string | null;
  roughnessMapUrl?: string | null;
  normalMapUrl?: string | null;
  aoMapUrl?: string | null;
  metalnessMapUrl?: string | null;
}
export type ShowcaseSurfaceKind =
  | 'asphalt'
  | 'rubberedAsphalt'
  | 'seamPatch'
  | 'gridBox'
  | 'edgeWear'
  | 'paintArrow'
  | 'drainageGrate'
  | 'pitConcrete'
  | 'barrierConcrete'
  | 'retainingWall'
  | 'runoffSpeckle';
export interface ShowcaseSurfaceMaterialOptions {
  anisotropy?: number;
  proceduralSeed?: number;
  pbr?: Partial<Record<ShowcaseSurfaceKind, ShowcasePbrSource>>;
}
export interface ShowcaseSurfaceMaterialSet {
  asphalt: THREE.MeshStandardMaterial;
  rubberedAsphalt: THREE.MeshStandardMaterial;
  seamPatch: THREE.MeshStandardMaterial;
  gridBox: THREE.MeshStandardMaterial;
  edgeWear: THREE.MeshStandardMaterial;
  paintArrow: THREE.MeshStandardMaterial;
  drainageGrate: THREE.MeshStandardMaterial;
  pitConcrete: THREE.MeshStandardMaterial;
  barrierConcrete: THREE.MeshStandardMaterial;
  retainingWall: THREE.MeshStandardMaterial;
  runoffSpeckle: THREE.MeshStandardMaterial;
  textures: THREE.CanvasTexture[];
  dispose: () => void;
}
function seededRandom(seed: number): () => number {
  let v = seed >>> 0;
  return () => {
    v = (Math.imul(v, 1664525) + 1013904223) >>> 0;
    return v / 0x100000000;
  };
}
function makeCanvas(size: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const clamped = Math.min(SHOWCASE_MAX_TEXTURE_PX, Math.max(16, Math.round(size)));
  const canvas = document.createElement('canvas');
  canvas.width = clamped;
  canvas.height = clamped;
  const ctx = canvas.getContext('2d')!;
  return [canvas, ctx];
}
function toTexture(canvas: HTMLCanvasElement, srgb: boolean): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
/** Fine asphalt aggregate grain, opaque. */
export function makeAsphaltAggregateTexture(seed = 0xA5FALT): THREE.CanvasTexture {
  void 0;
  return makeAggregateInner(seed, '#22262b', 9000);
}
function makeAggregateInner(seed: number, base: string, dots: number): THREE.CanvasTexture {
  const [canvas, ctx] = makeCanvas(256);
  const rand = seededRandom(seed);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < dots; i++) {
    const g = 26 + Math.floor(rand() * 34);
    ctx.fillStyle = 'rgb(' + g + ',' + (g + 2) + ',' + (g + 5) + ')';
    ctx.fillRect(rand() * 256, rand() * 256, 1.6, 1.6);
  }
  return toTexture(canvas, true);
}
/** Dark rubbered racing-line overlay baked opaque, no alpha blend needed. */
export function makeRubberedAsphaltTexture(seed = 0xRU8): THREE.CanvasTexture {
  const [canvas, ctx] = makeCanvas(256);
  const rand = seededRandom(77);
  ctx.fillStyle = '#1b1e22';
  ctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 5200; i++) {
    const g = 18 + Math.floor(rand() * 22);
    ctx.fillStyle = 'rgb(' + g + ',' + g + ',' + (g + 3) + ')';
    ctx.fillRect(rand() * 256, rand() * 256, 2, 1.2);
  }
  ctx.fillStyle = 'rgba(10,10,12,0.55)';
  ctx.fillRect(0, 96, 256, 64);
  void seed;
  return toTexture(canvas, true);
}
/** Tar seams plus rectangular repair patches, opaque. */
export function makeSeamPatchTexture(): THREE.CanvasTexture {
  const [canvas, ctx] = makeCanvas(256);
  ctx.fillStyle = '#23272d';
  ctx.fillRect(0, 0, 256, 256);
  ctx.strokeStyle = '#0e1114';
  ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(0, 64); ctx.lineTo(256, 70); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(40, 0); ctx.lineTo(52, 256); ctx.stroke();
  ctx.fillStyle = '#2b3036';
  ctx.fillRect(140, 140, 84, 64);
  ctx.strokeStyle = '#14171b'; ctx.lineWidth = 2;
  ctx.strokeRect(140, 140, 84, 64);
  return toTexture(canvas, true);
}
/** Start grid box: white outline on asphalt, opaque quad. */
export function makeGridBoxTexture(): THREE.CanvasTexture {
  const [canvas, ctx] = makeCanvas(128);
  ctx.fillStyle = '#22262b';
  ctx.fillRect(0, 0, 128, 128);
  ctx.strokeStyle = '#e8edf2'; ctx.lineWidth = 6;
  ctx.strokeRect(8, 8, 112, 112);
  return toTexture(canvas, true);
}
/** Edge wear: light scuffed band for road shoulders, opaque. */
export function makeEdgeWearTexture(): THREE.CanvasTexture {
  const [canvas, ctx] = makeCanvas(256);
  const rand = seededRandom(913);
  ctx.fillStyle = '#262b31';
  ctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 2600; i++) {
    const g = 150 + Math.floor(rand() * 60);
    ctx.fillStyle = 'rgba(' + g + ',' + g + ',' + g + ',0.25)';
    ctx.fillRect(rand() * 256, rand() * 256, 2.2, 1.4);
  }
  return toTexture(canvas, true);
}
/** Painted direction arrow tile, opaque white-on-asphalt. */
export function makePaintArrowTexture(): THREE.CanvasTexture {
  const [canvas, ctx] = makeCanvas(128);
  ctx.fillStyle = '#22262b';
  ctx.fillRect(0, 0, 128, 128);
  ctx.fillStyle = '#eef2f6';
  ctx.beginPath();
  ctx.moveTo(64, 14); ctx.lineTo(96, 62); ctx.lineTo(74, 62);
  ctx.lineTo(74, 114); ctx.lineTo(54, 114); ctx.lineTo(54, 62);
  ctx.lineTo(32, 62); ctx.closePath(); ctx.fill();
  return toTexture(canvas, true);
}
/** Drainage grate: dark slots on steel, opaque. */
export function makeDrainageGrateTexture(): THREE.CanvasTexture {
  const [canvas, ctx] = makeCanvas(128);
  ctx.fillStyle = '#3a4046';
  ctx.fillRect(0, 0, 128, 128);
  ctx.fillStyle = '#101315';
  for (let y = 10; y < 128; y += 18) ctx.fillRect(10, y, 108, 8);
  return toTexture(canvas, true);
}
/** Pit concrete: light broom-finish with control joints. */
export function makePitConcreteTexture(): THREE.CanvasTexture {
  const [canvas, ctx] = makeCanvas(256);
  const rand = seededRandom(441);
  ctx.fillStyle = '#9aa0a6';
  ctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 3800; i++) {
    const g = 140 + Math.floor(rand() * 40);
    ctx.fillStyle = 'rgb(' + g + ',' + g + ',' + (g - 4) + ')';
    ctx.fillRect(rand() * 256, rand() * 256, 1.5, 1.5);
  }
  ctx.strokeStyle = '#7c8288'; ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, 254, 254);
  ctx.beginPath(); ctx.moveTo(128, 0); ctx.lineTo(128, 256); ctx.stroke();
  return toTexture(canvas, true);
}
/** Precast barrier concrete with vertical joints. */
export function makeBarrierConcreteTexture(): THREE.CanvasTexture {
  const [canvas, ctx] = makeCanvas(256);
  ctx.fillStyle = '#b9bec4';
  ctx.fillRect(0, 0, 256, 256);
  ctx.fillStyle = '#a8adb3';
  ctx.fillRect(0, 200, 256, 56);
  ctx.strokeStyle = '#878d94'; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(64, 0); ctx.lineTo(64, 256); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(192, 0); ctx.lineTo(192, 256); ctx.stroke();
  return toTexture(canvas, true);
}
/** Retaining wall: darker stratified rock, distinct from barrier. */
export function makeRetainingWallTexture(): THREE.CanvasTexture {
  const [canvas, ctx] = makeCanvas(256);
  const rand = seededRandom(207);
  ctx.fillStyle = '#6b6257';
  ctx.fillRect(0, 0, 256, 256);
  for (let y = 0; y < 256; y += 32) {
    ctx.fillStyle = y % 64 ? '#5d554b' : '#756c5f';
    ctx.fillRect(0, y, 256, 30);
  }
  for (let i = 0; i < 1600; i++) {
    const g = 80 + Math.floor(rand() * 50);
    ctx.fillStyle = 'rgb(' + g + ',' + (g - 6) + ',' + (g - 14) + ')';
    ctx.fillRect(rand() * 256, rand() * 256, 2, 2);
  }
  return toTexture(canvas, true);
}
/** Runoff speckle: gray wash with stone flecks, opaque. */
export function makeRunoffSpeckleTexture(): THREE.CanvasTexture {
  const [canvas, ctx] = makeCanvas(256);
  const rand = seededRandom(318);
  ctx.fillStyle = '#676c72';
  ctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 4200; i++) {
    const g = 90 + Math.floor(rand() * 80);
    ctx.fillStyle = 'rgb(' + g + ',' + g + ',' + g + ')';
    ctx.fillRect(rand() * 256, rand() * 256, 1.7, 1.7);
  }
  return toTexture(canvas, true);
}
function std(color: number, map: THREE.Texture | null, rough: number, metal = 0): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, map, roughness: rough, metalness: metal });
}
/** Placeholder CC0 resolver: returns nulls so procedural stays active until assets land. */
export function resolveCc0Placeholder(kind: ShowcaseSurfaceKind): ShowcasePbrSource {
  void kind;
  return { mapUrl: null, roughnessMapUrl: null, normalMapUrl: null, aoMapUrl: null };
}
/** Swap real CC0 PBR maps onto an existing material without changing geometry. */
export async function applyPbrSource(material: THREE.MeshStandardMaterial, source: ShowcasePbrSource): Promise<void> {
  if (!source.mapUrl && !source.normalMapUrl && !source.roughnessMapUrl) return;
  const loader = new THREE.TextureLoader();
  const load = async (url?: string | null): Promise<THREE.Texture | null> => {
    if (!url) return null;
    const t = await loader.loadAsync(url);
    t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.RepeatWrapping;
    if (t.image && (t.image.width > 256 || t.image.height > 256)) t.image = t.image;
    return t;
  };
  const map = await load(source.mapUrl);
  if (map) { map.colorSpace = THREE.SRGBColorSpace; material.map = map; }
  const nrm = await load(source.normalMapUrl);
  if (nrm) material.normalMap = nrm;
  const rgh = await load(source.roughnessMapUrl);
  if (rgh) material.roughnessMap = rgh;
  material.needsUpdate = true;
}
/** Build the full opaque-first procedural set. Caller owns dispose. */
export function createShowcaseSurfaceMaterials(options: ShowcaseSurfaceMaterialOptions = {}): ShowcaseSurfaceMaterialSet {
  void options;
  const textures: THREE.CanvasTexture[] = [];
  const track = (t: THREE.CanvasTexture): THREE.CanvasTexture => { textures.push(t); return t; };
  const asphalt = std(0xffffff, track(makeAsphaltAggregateTexture(11)), 0.93);
  const rubberedAsphalt = std(0xffffff, track(makeRubberedAsphaltTexture(12)), 0.9);
  const seamPatch = std(0xffffff, track(makeSeamPatchTexture()), 0.92);
  const gridBox = std(0xffffff, track(makeGridBoxTexture()), 0.8);
  const edgeWear = std(0xffffff, track(makeEdgeWearTexture()), 0.9);
  const paintArrow = std(0xffffff, track(makePaintArrowTexture()), 0.75);
  const drainageGrate = std(0xffffff, track(makeDrainageGrateTexture()), 0.6, 0.35);
  const pitConcrete = std(0xffffff, track(makePitConcreteTexture()), 0.85);
  const barrierConcrete = std(0xffffff, track(makeBarrierConcreteTexture()), 0.8);
  const retainingWall = std(0xffffff, track(makeRetainingWallTexture()), 1.0);
  const runoffSpeckle = std(0xffffff, track(makeRunoffSpeckleTexture()), 0.97);
  const dispose = (): void => {
    textures.forEach((t) => t.dispose());
    [asphalt, rubberedAsphalt, seamPatch, gridBox, edgeWear, paintArrow,
      drainageGrate, pitConcrete, barrierConcrete, retainingWall, runoffSpeckle
    ].forEach((m) => m.dispose());
  };
  return { asphalt, rubberedAsphalt, seamPatch, gridBox, edgeWear, paintArrow, drainageGrate, pitConcrete, barrierConcrete, retainingWall, runoffSpeckle, textures, dispose };
}
export function disposeShowcaseSurfaceMaterials(set: ShowcaseSurfaceMaterialSet): void { set.dispose(); }

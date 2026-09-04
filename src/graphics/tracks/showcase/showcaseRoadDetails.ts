import * as THREE from 'three';
/**
 * Showcase road details - visual only, deterministic builders.
 *
 * Covers grid boxes, edge wear, painted arrows, drainage grates,
 * seams/patches, pit-concrete apron trim and runoff-speckle bands.
 * No physics or road geometry changes; decals ride the banked road
 * basis with small polygonOffset lifts. Trackside items stay outside
 * the full 18m recovery runoff via barrierOffsetM/path parameters.
 * Textures <=256px reused from showcaseSurfaceMaterials; opaque-first.
 * Not integrated yet: pure builder APIs for a later integrator.
 */
export const SHOWCASE_RUNOFF_WIDTH_M = 18;
export const SHOWCASE_MAX_ARROW_COUNT = 24;
export const SHOWCASE_MAX_GRATE_COUNT = 40;
export const SHOWCASE_MAX_GRID_COUNT = 24;
export const SHOWCASE_MAX_SEAM_COUNT = 60;
export interface TrackBasisSampleLike {
  center: THREE.Vector3;
  tangent: THREE.Vector3;
  lateral: THREE.Vector3;
  bankedLateral: THREE.Vector3;
  normal: THREE.Vector3;
}
export interface TrackPathLike {
  sampleAt: (u: number) => TrackBasisSampleLike;
}
export interface ShowcaseRoadDetailOptions {
  barrierOffsetM: number;
  outerRunoffM: number;
  seed?: number;
  yLiftM?: number;
  maxArrows?: number;
  maxGrates?: number;
}
export interface PlacedDetail {
  u: number;
  lateralOffsetM: number;
}
function seededRandom(seed: number): () => number {
  let v = seed >>> 0;
  return () => { v = (Math.imul(v, 1664525) + 1013904223) >>> 0; return v / 0x100000000; };
}
function wrapU(u: number): number { return ((u % 1) + 1) % 1; }
/** True when a lateral offset clears the full runoff shelf. */
export function isOutsideRecoveryRunoff(lateralM: number, outerRunoffM: number): boolean {
  return Math.abs(lateralM) > outerRunoffM;
}
/** True when a lateral offset clears the barrier line. */
export function isOutsideBarrier(lateralM: number, barrierOffsetM: number): boolean {
  return Math.abs(lateralM) >= barrierOffsetM;
}
/** Clamp a requested trackside offset outside barrier line, preserving side. */
export function clampToTrackside(lateralM: number, barrierOffsetM: number): number {
  const side = lateralM >= 0 ? 1 : -1;
  return side * Math.max(Math.abs(lateralM), barrierOffsetM);
}
/** Validate a batch of trackside placements; returns violations. */
export function validateTracksidePlacements(items: PlacedDetail[], barrierOffsetM: number, outerRunoffM: number): PlacedDetail[] {
  return items.filter((p) => !isOutsideRecoveryRunoff(p.lateralOffsetM, outerRunoffM) || !isOutsideBarrier(p.lateralOffsetM, barrierOffsetM));
}
function basisQuaternion(s: TrackBasisSampleLike): THREE.Quaternion {
  const m = new THREE.Matrix4().makeBasis(s.bankedLateral, s.normal, s.tangent);
  return new THREE.Quaternion().setFromRotationMatrix(m);
}
function placeOnRoad(path: TrackPathLike, u: number, lateralM: number, liftM: number, out: THREE.Matrix4, quat: THREE.Quaternion, scl: THREE.Vector3): THREE.Matrix4 {
  const s = path.sampleAt(wrapU(u));
  quat.copy(basisQuaternion(s));
  const pos = s.center.clone().addScaledVector(s.bankedLateral, lateralM).addScaledVector(s.normal, liftM);
  out.compose(pos, quat, scl);
  return out;
}
function finalizeInstanced(mesh: THREE.InstancedMesh): void {
  mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere();
  mesh.updateMatrix();
  mesh.matrixAutoUpdate = false;
}
/** Start grid boxes on the road ribbon (on-road paint exception). */
export function buildGridBoxDecals(path: TrackPathLike, material: THREE.Material, options: ShowcaseRoadDetailOptions & { startU?: number; rows?: number }): THREE.InstancedMesh {
  const rows = Math.min(SHOWCASE_MAX_GRID_COUNT, options.rows ?? 12);
  const startU = options.startU ?? 0.018;
  const geo = new THREE.PlaneGeometry(2.2, 3.4);
  geo.rotateX(-Math.PI / 2);
  const mesh = new THREE.InstancedMesh(geo, material, rows * 2);
  const m = new THREE.Matrix4(); const q = new THREE.Quaternion(); const one = new THREE.Vector3(1, 1, 1);
  let idx = 0;
  for (let r = 0; r < rows; r++) {
    const u = wrapU(startU - 0.0022 * (r + 1));
    for (const side of [-4.4, 4.4]) {
      placeOnRoad(path, u, side, options.yLiftM ?? 0.045, m, q, one);
      mesh.setMatrixAt(idx++, m);
    }
  }
  mesh.count = idx;
  mesh.renderOrder = 2;
  finalizeInstanced(mesh);
  return mesh;
}
/** Painted direction arrows on road center/off-center, opaque quads. */
export function buildPaintedArrows(path: TrackPathLike, material: THREE.Material, options: ShowcaseRoadDetailOptions & { us?: number[] }): THREE.InstancedMesh {
  const fallback = [0.12, 0.30, 0.52, 0.70, 0.88];
  const us = (options.us ?? fallback).slice(0, options.maxArrows ?? SHOWCASE_MAX_ARROW_COUNT);
  const geo = new THREE.PlaneGeometry(1.6, 3.2);
  geo.rotateX(-Math.PI / 2);
  const mesh = new THREE.InstancedMesh(geo, material, Math.max(1, us.length));
  const m = new THREE.Matrix4(); const q = new THREE.Quaternion(); const one = new THREE.Vector3(1, 1, 1);
  us.forEach((u, i) => placeOnRoad(path, u, 0, options.yLiftM ?? 0.04, m, q, one) && mesh.setMatrixAt(i, m));
  mesh.count = us.length;
  mesh.renderOrder = 2;
  finalizeInstanced(mesh);
  return mesh;
}
/** Transverse tar seams + patch quads on road, deterministic spacing. */
export function buildSeamPatchStrips(path: TrackPathLike, material: THREE.Material, options: ShowcaseRoadDetailOptions & { count?: number }): THREE.InstancedMesh {
  const rand = seededRandom(options.seed ?? 1234);
  const count = Math.min(SHOWCASE_MAX_SEAM_COUNT, options.count ?? 40);
  const geo = new THREE.PlaneGeometry(19.0, 0.5);
  geo.rotateX(-Math.PI / 2);
  const mesh = new THREE.InstancedMesh(geo, material, count);
  const m = new THREE.Matrix4(); const q = new THREE.Quaternion(); const one = new THREE.Vector3(1, 1, 1);
  for (let i = 0; i < count; i++) {
    const u = (i / count + rand() * 0.004) % 1;
    placeOnRoad(path, u, (rand() - 0.5) * 1.2, (options.yLiftM ?? 0.035) + rand() * 0.004, m, q, one);
    mesh.setMatrixAt(i, m);
  }
  mesh.renderOrder = 1;
  finalizeInstanced(mesh);
  return mesh;
}
/** Edge-wear bands hugging white lines, still on road shoulder. */
export function buildEdgeWearStrips(path: TrackPathLike, material: THREE.Material, options: ShowcaseRoadDetailOptions & { segments?: number }): THREE.Group {
  const group = new THREE.Group();
  group.name = 'showcase-edge-wear';
  const segs = options.segments ?? 64;
  const geo = new THREE.PlaneGeometry(0.9, 8);
  geo.rotateX(-Math.PI / 2);
  const mk = (side: 1 | -1): THREE.InstancedMesh => {
    const mesh = new THREE.InstancedMesh(geo, material, segs);
    const m = new THREE.Matrix4(); const q = new THREE.Quaternion(); const one = new THREE.Vector3(1, 1, 1);
    for (let i = 0; i < segs; i++) placeOnRoad(path, i / segs, side * 9.2, options.yLiftM ?? 0.038, m, q, one) && mesh.setMatrixAt(i, m);
    finalizeInstanced(mesh);
    return mesh;
  };
  group.add(mk(1), mk(-1));
  return group;
}
/** Drainage grates: trackside only, clamped outside barrier line. */
export function buildDrainageGrates(path: TrackPathLike, material: THREE.Material, options: ShowcaseRoadDetailOptions): THREE.InstancedMesh {
  const count = Math.min(SHOWCASE_MAX_GRATE_COUNT, options.maxGrates ?? 24);
  const geo = new THREE.BoxGeometry(1.2, 0.08, 0.8);
  const mesh = new THREE.InstancedMesh(geo, material, count);
  const m = new THREE.Matrix4(); const q = new THREE.Quaternion(); const one = new THREE.Vector3(1, 1, 1);
  for (let i = 0; i < count; i++) {
    const u = (i + 0.5) / count;
    const side = i % 2 === 0 ? 1 : -1;
    const lateral = clampToTrackside(side * (options.barrierOffsetM + 1.2), options.barrierOffsetM);
    const s = path.sampleAt(wrapU(u));
    q.copy(basisQuaternion(s));
    const pos = s.center.clone().addScaledVector(s.bankedLateral, lateral).addScaledVector(s.normal, 0.05);
    m.compose(pos, q, one);
    mesh.setMatrixAt(i, m);
  }
  mesh.castShadow = false; mesh.receiveShadow = true;
  finalizeInstanced(mesh);
  return mesh;
}
/** Pit-concrete trim band outside barrier on pit side only. */
export function buildPitConcreteTrim(path: TrackPathLike, material: THREE.Material, options: ShowcaseRoadDetailOptions & { pitU?: number; lengthM?: number }): THREE.Mesh {
  const pitU = options.pitU ?? 0.025;
  const s = path.sampleAt(wrapU(pitU));
  const lateral = clampToTrackside(-(options.barrierOffsetM + 7.0), options.barrierOffsetM);
  const geo = new THREE.BoxGeometry(8.0, 0.08, options.lengthM ?? 120);
  const mesh = new THREE.Mesh(geo, material);
  mesh.position.copy(s.center).addScaledVector(s.bankedLateral, lateral).addScaledVector(s.normal, 0.03);
  mesh.quaternion.copy(basisQuaternion(s));
  mesh.receiveShadow = true;
  mesh.updateMatrix(); mesh.matrixAutoUpdate = false;
  return mesh;
}
/** Aggregate helper for later integrator; trackside parts pre-validated. */
export function buildShowcaseRoadDetails(path: TrackPathLike, materials: { gridBox: THREE.Material; paintArrow: THREE.Material; seamPatch: THREE.Material; edgeWear: THREE.Material; drainageGrate: THREE.Material; pitConcrete: THREE.Material }, options: ShowcaseRoadDetailOptions): THREE.Group {
  const group = new THREE.Group();
  group.name = 'showcase-road-details';
  group.add(buildGridBoxDecals(path, materials.gridBox, options));
  group.add(buildPaintedArrows(path, materials.paintArrow, options));
  group.add(buildSeamPatchStrips(path, materials.seamPatch, options));
  group.add(buildEdgeWearStrips(path, materials.edgeWear, options));
  group.add(buildDrainageGrates(path, materials.drainageGrate, options));
  group.add(buildPitConcreteTrim(path, materials.pitConcrete, options));
  return group;
}
export function disposeShowcaseRoadDetails(group: THREE.Group): void {
  group.traverse((o) => { if (o instanceof THREE.InstancedMesh) o.dispose(); });
}

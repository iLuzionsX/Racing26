import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import {
  KENNEY_VENUE_ASSETS,
  assertNoRoadMesh,
  type KenneyVenueAssetId,
} from './kenneyAssetManifest';

/**
 * Real CC0 venue compositor (not yet integrated into core).
 *
 * - GLTFLoader with per-id cache; one network fetch max per id.
 * - Safe clone per placement (shares GPU buffers with cache).
 * - Uniform scale normalized from measured Box3 (length-first for display cars).
 * - Selective shadows from the manifest.
 * - All lateral offsets derived from barrierOffsetM + clearance, so props
 *   stay outside the full 18 m recovery runoff (caller passes outerRunoffM).
 * - Any remote failure warns and continues; never throws into the scene build.
 */

export interface VenueTrackSample {
  center: THREE.Vector3;
  tangent: THREE.Vector3;
  lateral: THREE.Vector3;
  bankedLateral: THREE.Vector3;
  normal: THREE.Vector3;
}

export interface VenuePath {
  sampleAt(u: number): VenueTrackSample;
}

export interface VenueInstanceSpec {
  asset: KenneyVenueAssetId;
  u: number;
  lateralOffsetM: number;
  upOffsetM?: number;
  yawOffsetRad?: number;
}

export interface VenueSpecBuilderArgs {
  barrierOffsetM: number;
  outerRunoffM?: number;
  minClearanceBehindBarrierM?: number;
}

export interface KenneyVenueBuildOptions extends VenueSpecBuilderArgs {
  path: VenuePath;
  loader?: KenneyAssetLoader;
  include?: KenneyVenueAssetId[];
}

export interface KenneyVenueBuildResult {
  group: THREE.Group;
  specs: VenueInstanceSpec[];
  placed: VenueInstanceSpec[];
  missing: KenneyVenueAssetId[];
}

export const DEFAULT_OUTER_RUNOFF_M = 29.25;
export const DEFAULT_CLEARANCE_BEHIND_BARRIER_M = 2.0;

export function venueLateralOutsideBarrier(
  barrierOffsetM: number,
  clearanceM: number,
  side: 1 | -1,
): number {
  return side * (Math.abs(barrierOffsetM) + Math.abs(clearanceM));
}

export function isOutsideRecoveryRunoff(lateralOffsetM: number, outerRunoffM: number): boolean {
  return Math.abs(lateralOffsetM) > Math.abs(outerRunoffM) + 1e-9;
}

function wrapU(u: number): number {
  return ((u % 1) + 1) % 1;
}

/** Pure deterministic cluster list. No I/O so it is unit-testable. */
export function buildVenueInstanceSpecs(args: VenueSpecBuilderArgs): VenueInstanceSpec[] {
  const barrier = Math.abs(args.barrierOffsetM);
  const clearance = Math.abs(args.minClearanceBehindBarrierM ?? DEFAULT_CLEARANCE_BEHIND_BARRIER_M);
  const at = (side: 1 | -1, extraM: number): number => venueLateralOutsideBarrier(barrier, clearance + extraM, side);
  const specs: VenueInstanceSpec[] = [];
  // Grandstands (start straight + mid-lap bowl, all on + side).
  specs.push({ asset: 'grandStandCovered', u: wrapU(0.032), lateralOffsetM: at(1, 10), upOffsetM: 0.05 });
  specs.push({ asset: 'grandStandCovered', u: wrapU(0.045), lateralOffsetM: at(1, 11.5), upOffsetM: 0.05 });
  specs.push({ asset: 'grandStandCoveredRound', u: wrapU(0.36), lateralOffsetM: at(1, 12), upOffsetM: 0.05 });
  // Paddock / pits (start straight, - side).
  specs.push({ asset: 'pitsGarage', u: wrapU(0.012), lateralOffsetM: at(-1, 5), upOffsetM: 0.05 });
  specs.push({ asset: 'pitsGarage', u: wrapU(0.02), lateralOffsetM: at(-1, 5), upOffsetM: 0.05 });
  specs.push({ asset: 'pitsGarage', u: wrapU(0.028), lateralOffsetM: at(-1, 5), upOffsetM: 0.05 });
  specs.push({ asset: 'pitsOffice', u: wrapU(0.016), lateralOffsetM: at(-1, 10), upOffsetM: 0.05 });
  specs.push({ asset: 'pitsOffice', u: wrapU(0.033), lateralOffsetM: at(-1, 10), upOffsetM: 0.05 });
  specs.push({ asset: 'tentLong', u: wrapU(0.022), lateralOffsetM: at(-1, 15), upOffsetM: 0.05 });
  specs.push({ asset: 'tentLong', u: wrapU(0.975), lateralOffsetM: at(-1, 15), upOffsetM: 0.05 });
  // Display cars inside paddock (well behind barrier).
  specs.push({ asset: 'raceCarGreen', u: wrapU(0.019), lateralOffsetM: at(-1, 8), upOffsetM: 0.06, yawOffsetRad: Math.PI / 2 });
  specs.push({ asset: 'raceCarOrange', u: wrapU(0.024), lateralOffsetM: at(-1, 8), upOffsetM: 0.06, yawOffsetRad: -Math.PI / 2 });
  // Fences along start straight (both sides, just behind barrier).
  for (let i = 0; i < 6; i += 1) {
    const u = wrapU(0.0 + i * 0.01);
    specs.push({ asset: 'fenceStraight', u, lateralOffsetM: at(1, 1.0), upOffsetM: 0.03 });
    specs.push({ asset: 'fenceStraight', u, lateralOffsetM: at(-1, 1.0), upOffsetM: 0.03 });
  }
  // Billboards alternating sides.
  const boards: Array<[number, 1 | -1]> = [[0.1, 1], [0.3, -1], [0.55, 1], [0.7, -1], [0.9, 1]];
  for (const [u, side] of boards) specs.push({ asset: 'billboard', u: wrapU(u), lateralOffsetM: at(side, 2.0), upOffsetM: 0.05, yawOffsetRad: Math.PI / 2 });
  // Modern light posts every ~8% of lap, alternating.
  for (let i = 0; i < 12; i += 1) {
    const side: 1 | -1 = i % 2 === 0 ? 1 : -1;
    specs.push({ asset: 'lightPostModern', u: wrapU(0.02 + i * 0.08), lateralOffsetM: at(side, 1.5), upOffsetM: 0.02 });
  }
  // Start/finish props (+ side).
  specs.push({ asset: 'flagCheckersSmall', u: wrapU(0.018), lateralOffsetM: at(1, 0.5), upOffsetM: 0.03 });
  specs.push({ asset: 'camera_exclusive', u: wrapU(0.022), lateralOffsetM: at(1, 0.8), upOffsetM: 0.03 });
  specs.push({ asset: 'radarEquipment', u: wrapU(0.026), lateralOffsetM: at(1, 0.8), upOffsetM: 0.03 });
  return specs;
}

export function filterSpecsOutsideRunoff(specs: VenueInstanceSpec[], outerRunoffM: number): VenueInstanceSpec[] {
  return specs.filter((s) => isOutsideRecoveryRunoff(s.lateralOffsetM, outerRunoffM));
}

export function cloneCachedScene(source: THREE.Group): THREE.Group {
  const cloned = source.clone(true);
  cloned.updateMatrixWorld(true);
  return cloned;
}

export function measuredHeightM(object: THREE.Object3D): number {
  object.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(object);
  const size = new THREE.Vector3();
  box.getSize(size);
  return Number.isFinite(size.y) ? size.y : 0;
}

export function measuredLengthM(object: THREE.Object3D): number {
  object.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(object);
  const size = new THREE.Vector3();
  box.getSize(size);
  if (!Number.isFinite(size.x) || !Number.isFinite(size.z)) return 0;
  return Math.max(size.x, size.z);
}

/** Uniformly rescale to manifest target; returns applied scale (1 = untouched). */
export function normalizeObjectToTarget(id: KenneyVenueAssetId, object: THREE.Group): number {
  const e = KENNEY_VENUE_ASSETS[id];
  let scale = 1;
  if (e.targetLengthM !== undefined && (e.category === 'displayVehicle')) {
    const len = measuredLengthM(object);
    if (Number.isFinite(len) && len > 0.05 && Number.isFinite(e.targetLengthM) && e.targetLengthM > 0) {
      const s = e.targetLengthM / len;
      if (Number.isFinite(s) && s >= 0.25 && s <= 4) scale = s;
    }
  } else if (e.targetHeightM !== undefined) {
    const h = measuredHeightM(object);
    if (Number.isFinite(h) && h > 0.05 && Number.isFinite(e.targetHeightM) && e.targetHeightM > 0) {
      const s = e.targetHeightM / h;
      if (Number.isFinite(s) && s >= 0.25 && s <= 4) scale = s;
    }
  }
  if (scale !== 1) {
    object.scale.multiplyScalar(scale);
    object.updateMatrixWorld(true);
  }
  return scale;
}

export function applyShadowFlags(object: THREE.Object3D, cast: boolean, receive: boolean): void {
  object.traverse((child) => {
    if ((child as THREE.Mesh).isMesh) {
      const mesh = child as THREE.Mesh;
      mesh.castShadow = cast;
      mesh.receiveShadow = receive;
    }
  });
}

export class KenneyAssetLoader {
  private readonly gltf = new GLTFLoader();
  private readonly cache = new Map<string, THREE.Group>();
  private readonly inflight = new Map<string, Promise<THREE.Group | null>>();

  public has(id: KenneyVenueAssetId): boolean {
    return this.cache.has(id);
  }

  public clear(): void {
    this.cache.clear();
    this.inflight.clear();
  }

  public async loadAsset(id: KenneyVenueAssetId): Promise<THREE.Group | null> {
    try {
      assertNoRoadMesh(id);
    } catch (err) {
      console.warn(String(err));
      return null;
    }
    const cached = this.cache.get(id);
    if (cached) return cached;
    const pending = this.inflight.get(id);
    if (pending) return pending;
    const task = (async (): Promise<THREE.Group | null> => {
      try {
        const gltf = await this.gltf.loadAsync(KENNEY_VENUE_ASSETS[id].url);
        const scene = (gltf.scene as THREE.Group) ?? new THREE.Group();
        scene.updateMatrixWorld(true);
        this.cache.set(id, scene);
        return scene;
      } catch (err) {
        console.warn(`[kenney-venue] remote asset failed, continuing procedurally: ${id}`, err);
        return null;
      } finally {
        this.inflight.delete(id);
      }
    })();
    this.inflight.set(id, task);
    return task;
  }

  public async cloneAsset(id: KenneyVenueAssetId): Promise<THREE.Group | null> {
    const source = await this.loadAsset(id);
    if (!source) return null;
    try {
      return cloneCachedScene(source);
    } catch (err) {
      console.warn(`[kenney-venue] clone failed for ${id}`, err);
      return null;
    }
  }
}

function placeClonedObject(path: VenuePath, spec: VenueInstanceSpec, object: THREE.Group): void {
  const s = path.sampleAt(spec.u);
  const pos = s.center.clone().addScaledVector(s.bankedLateral, spec.lateralOffsetM).addScaledVector(s.normal, spec.upOffsetM ?? 0.03);
  object.position.copy(pos);
  const baseYaw = Math.atan2(s.tangent.x, s.tangent.z);
  object.rotation.set(0, baseYaw + (spec.yawOffsetRad ?? 0), 0);
  object.updateMatrixWorld(true);
}

/** Authored cluster composition. Never throws: missing GLBs are skipped. */
export async function composeKenneyVenueGroup(options: KenneyVenueBuildOptions): Promise<KenneyVenueBuildResult> {
  const group = new THREE.Group();
  group.name = 'kenney-venue-assets';
  const outer = Math.abs(options.outerRunoffM ?? DEFAULT_OUTER_RUNOFF_M);
  const allSpecs = buildVenueInstanceSpecs(options);
  const wanted = options.include ? new Set<KenneyVenueAssetId>(options.include) : null;
  const specs = allSpecs.filter((s) => (!wanted || wanted.has(s.asset)) && isOutsideRecoveryRunoff(s.lateralOffsetM, outer));
  const loader = options.loader ?? new KenneyAssetLoader();
  const placed: VenueInstanceSpec[] = [];
  const missing: KenneyVenueAssetId[] = [];
  for (const spec of specs) {
    const cloned = await loader.cloneAsset(spec.asset);
    if (!cloned) {
      if (!missing.includes(spec.asset)) missing.push(spec.asset);
      continue;
    }
    try {
      normalizeObjectToTarget(spec.asset, cloned);
      const e = KENNEY_VENUE_ASSETS[spec.asset];
      applyShadowFlags(cloned, e.castShadow, e.receiveShadow);
      placeClonedObject(options.path, spec, cloned);
      group.add(cloned);
      placed.push(spec);
    } catch (err) {
      console.warn(`[kenney-venue] placement skipped for ${spec.asset}`, err);
      if (!missing.includes(spec.asset)) missing.push(spec.asset);
    }
  }
  return { group, specs, placed, missing };
}

/** Non-throwing wrapper for a later integrator; returns an empty group on total failure. */
export async function tryComposeKenneyVenueGroup(options: KenneyVenueBuildOptions): Promise<THREE.Group> {
  try {
    const result = await composeKenneyVenueGroup(options);
    return result.group;
  } catch (err) {
    console.warn('[kenney-venue] venue composition failed, using empty group', err);
    return new THREE.Group();
  }
}

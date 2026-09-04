import * as THREE from 'three';

/**
 * Performance architecture for the Showcase Circuit venue pass.
 *
 * Geometry, surface, spawn and physics are quantitatively validated and must
 * not change. This module only documents the render budget and provides
 * allocation-free, behavior-preserving helpers for richer decoration:
 * instancing, shared geometries/materials, static-matrix freezing, correct
 * instanced bounds, and complete disposal (including InstancedMesh buffers).
 *
 * All placement must remain deterministic and keep the racing corridor plus
 * the full 18 m runoff visually and physically clear.
 */

export const SHOWCASE_RENDER_BUDGET = {
  // Total draw calls for the full circuit group (ground + ribbons + instanced
  // sets + gantries/stands/landmarks). Current build is ~36; allow headroom
  // for venue dressing while staying mobile-friendly.
  maxDrawCalls: 60,
  // Approximate triangle budget for mid-tier mobile at 60 fps with one 2048
  // shadow cascade. Current ribbons/berm/instancing are well under this.
  maxTriangles: 350000,
  // Canvas textures only (checker + number boards). Keep each <=256px and
  // total GPU texture memory for track dressing small.
  maxTrackTextureBytes: 8 * 1024 * 1024,
  maxTextureDimensionPx: 256,
  // Single directional shadow map is sufficient; venue props must not add
  // additional shadow-casting lights.
  maxShadowMaps: 1,
  shadowMapSizePx: 2048,
} as const;

/**
 * Freeze a static track mesh after position/quaternion are final. The circuit
 * group never moves, so skipping per-frame local-matrix recompute is free.
 * No allocation; safe only for meshes that never animate.
 */
export function finalizeStaticMesh(mesh: THREE.Mesh): void {
  mesh.updateMatrix();
  mesh.matrixAutoUpdate = false;
}

/**
 * Mark an InstancedMesh as fully static: hint StaticDrawUsage and compute
 * the instanced bounding sphere once so frustum culling is correct. Without
 * this, distributed instances can be incorrectly culled or never culled.
 */
export function finalizeInstancedMesh(mesh: THREE.InstancedMesh): void {
  mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
  mesh.instanceMatrix.needsUpdate = true;
  if (typeof (mesh as THREE.InstancedMesh).computeBoundingSphere === 'function') {
    (mesh as THREE.InstancedMesh).computeBoundingSphere();
  }
  mesh.updateMatrix();
  mesh.matrixAutoUpdate = false;
} 

/**
 * Complete disposal for the circuit group. In addition to shared geometry /
 * material / texture disposal (deduped via Sets), this releases per-
 * InstancedMesh GPU instance buffers via dispose(). Shared geometries within
 * one build are disposed exactly once via the Set.
 */
export function disposeShowcaseGroup(group: THREE.Group): void {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  const instanced: THREE.InstancedMesh[] = [];

  group.traverse((object) => {
    const maybeInstanced = object as THREE.InstancedMesh;
    if ((maybeInstanced as unknown as { isInstancedMesh?: boolean }).isInstancedMesh) {
      instanced.push(maybeInstanced);
    }
    if (!(object instanceof THREE.Mesh)) return;
    if (object.geometry) geometries.add(object.geometry as THREE.BufferGeometry);
    const meshMaterials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of meshMaterials) {
      if (!material) continue;
      materials.add(material as THREE.Material);
      const record = material as THREE.Material & Record<string, unknown>;
      for (const key of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap']) {
        const texture = record[key];
        if (texture instanceof THREE.Texture) textures.add(texture);
      }
    }
  });

  for (const mesh of instanced) {
    try {
      mesh.dispose();
    } catch {
      // ignore: dispose is best-effort across three.js revisions
    }
  }
  geometries.forEach((geometry) => geometry.dispose());
  textures.forEach((texture) => texture.dispose());
  materials.forEach((material) => material.dispose());
}

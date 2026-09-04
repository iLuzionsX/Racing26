import * as THREE from 'three';
import { finalizeInstancedMesh } from './trackPerformance';

export interface TerrainTrackSample {
  center: THREE.Vector3;
  tangent: THREE.Vector3;
  lateral: THREE.Vector3;
  bankedLateral: THREE.Vector3;
  normal: THREE.Vector3;
}
export interface TerrainTrackPath { sampleAt(u: number): TerrainTrackSample; }
export interface TerrainCompositionOptions {
  barrierOffsetM: number;
  bermHalfWidthM: number;
  trackCenterX: number;
}
export interface TerrainPlacementSpec { kind: 'wall' | 'rock' | 'tree' | 'bush'; u: number; lateralM: number; }

function seeded(seed: number): () => number {
  let v = seed >>> 0;
  return () => { v = (Math.imul(v, 1664525) + 1013904223) >>> 0; return v / 0x100000000; };
}
function terrainY(s: TerrainTrackSample, lateralM: number, bermHalfWidthM: number): number {
  const roadY = s.center.y + s.bankedLateral.y * lateralM - 0.42;
  const t = THREE.MathUtils.clamp((Math.abs(lateralM) - 34) / Math.max(1, bermHalfWidthM - 34), 0, 1);
  const smooth = t * t * (3 - 2 * t);
  return THREE.MathUtils.lerp(roadY, 0, smooth);
}
export function buildTerrainPlacementSpecs(barrierOffsetM: number): TerrainPlacementSpec[] {
  const specs: TerrainPlacementSpec[] = [];
  for (let i = 0; i < 24; i++) specs.push({ kind: 'wall', u: 0.535 + (i / 24) * 0.18, lateralM: (i % 2 ? -1 : 1) * (barrierOffsetM + 5) });
  for (let i = 0; i < 40; i++) specs.push({ kind: 'rock', u: 0.54 + (i / 40) * 0.16, lateralM: (i % 2 ? -1 : 1) * (barrierOffsetM + 9 + (i % 6) * 2.5) });
  for (let i = 0; i < 72; i++) specs.push({ kind: 'tree', u: (i / 72 + (i % 7) * 0.0025) % 1, lateralM: (i % 2 ? -1 : 1) * (barrierOffsetM + 18 + (i % 8) * 3) });
  for (let i = 0; i < 48; i++) specs.push({ kind: 'bush', u: (0.01 + i * 0.021) % 1, lateralM: (i % 3 ? 1 : -1) * (barrierOffsetM + 12 + (i % 5) * 2) });
  return specs;
}

export const SHOWCASE_TERRAIN_DRAW_CALLS = 7;

export function buildTerrainComposition(path: TerrainTrackPath, options: TerrainCompositionOptions): THREE.Group {
  const group = new THREE.Group();
  group.name = 'showcase-layered-terrain';
  const rng = seeded(0xc0ffee);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const specs = buildTerrainPlacementSpecs(options.barrierOffsetM);

  const wallMat = new THREE.MeshStandardMaterial({ color: 0x746d63, roughness: 0.96 });
  const rockMat = new THREE.MeshStandardMaterial({ color: 0x665c50, roughness: 1 });
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x493729, roughness: 1 });
  const nearGreen = new THREE.MeshStandardMaterial({ color: 0x214d31, roughness: 1 });
  const midGreen = new THREE.MeshStandardMaterial({ color: 0x315f3b, roughness: 1 });
  const bushMat = new THREE.MeshStandardMaterial({ color: 0x456d38, roughness: 1 });
  const ridgeMat = new THREE.MeshStandardMaterial({ color: 0x617381, roughness: 1 });

  const walls = new THREE.InstancedMesh(new THREE.BoxGeometry(8, 3.0, 0.8), wallMat, 24);
  let wi = 0;
  for (const spec of specs.filter((s) => s.kind === 'wall')) {
    const s = path.sampleAt(spec.u);
    e.set(0, Math.atan2(s.tangent.x, s.tangent.z), 0); q.setFromEuler(e);
    const p = s.center.clone().addScaledVector(s.bankedLateral, spec.lateralM);
    p.y = terrainY(s, spec.lateralM, options.bermHalfWidthM) + 1.25;
    m.compose(p, q, new THREE.Vector3(1, 1, 1)); walls.setMatrixAt(wi++, m);
  }
  walls.receiveShadow = true; finalizeInstancedMesh(walls); group.add(walls);

  const rocks = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(1, 0), rockMat, 40);
  let ri = 0;
  for (const spec of specs.filter((s) => s.kind === 'rock')) {
    const s = path.sampleAt(spec.u);
    const size = 3.2 + rng() * 4.8;
    const p = s.center.clone().addScaledVector(s.lateral, spec.lateralM);
    p.y = terrainY(s, spec.lateralM, options.bermHalfWidthM) + size * 0.32;
    e.set(rng() * 0.28, rng() * Math.PI, rng() * 0.28); q.setFromEuler(e);
    m.compose(p, q, new THREE.Vector3(size, size * (1.0 + rng() * 0.55), size)); rocks.setMatrixAt(ri++, m);
  }
  rocks.castShadow = true; finalizeInstancedMesh(rocks); group.add(rocks);

  const treeSpecs = specs.filter((s) => s.kind === 'tree');
  const trunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.16, 0.25, 3.4, 6), trunkMat, treeSpecs.length);
  const crownsNear = new THREE.InstancedMesh(new THREE.ConeGeometry(1.8, 5.2, 7), nearGreen, 36);
  const crownsMid = new THREE.InstancedMesh(new THREE.ConeGeometry(2.25, 4.4, 7), midGreen, 36);
  let ni = 0, mi = 0;
  treeSpecs.forEach((spec, i) => {
    const s = path.sampleAt(spec.u); const sc = 0.78 + rng() * 0.65;
    const p = s.center.clone().addScaledVector(s.lateral, spec.lateralM);
    const base = terrainY(s, spec.lateralM, options.bermHalfWidthM);
    q.identity();
    m.compose(new THREE.Vector3(p.x, base + 1.7 * sc, p.z), q, new THREE.Vector3(sc, sc, sc)); trunks.setMatrixAt(i, m);
    m.compose(new THREE.Vector3(p.x, base + 4.5 * sc, p.z), q, new THREE.Vector3(sc, sc, sc));
    if (i % 2 === 0) crownsNear.setMatrixAt(ni++, m); else crownsMid.setMatrixAt(mi++, m);
  });
  trunks.castShadow = false; crownsNear.castShadow = false; crownsMid.castShadow = false;
  finalizeInstancedMesh(trunks); finalizeInstancedMesh(crownsNear); finalizeInstancedMesh(crownsMid);
  group.add(trunks, crownsNear, crownsMid);

  const bushes = new THREE.InstancedMesh(new THREE.SphereGeometry(0.9, 7, 5), bushMat, 48);
  let bi = 0;
  for (const spec of specs.filter((s) => s.kind === 'bush')) {
    const s = path.sampleAt(spec.u); const sc = 0.7 + rng() * 0.8;
    const p = s.center.clone().addScaledVector(s.lateral, spec.lateralM);
    p.y = terrainY(s, spec.lateralM, options.bermHalfWidthM) + 0.5;
    q.identity(); m.compose(p, q, new THREE.Vector3(sc, sc * 0.7, sc)); bushes.setMatrixAt(bi++, m);
  }
  finalizeInstancedMesh(bushes); group.add(bushes);

  const ridges = new THREE.InstancedMesh(new THREE.ConeGeometry(1, 1, 6), ridgeMat, 16);
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2 + 0.16;
    const radius = 720 + rng() * 160; const h = 120 + rng() * 150; const rs = 85 + rng() * 75;
    e.set(0, rng() * Math.PI, 0); q.setFromEuler(e);
    m.compose(new THREE.Vector3(options.trackCenterX + Math.cos(a) * radius, h * 0.5 - 8, Math.sin(a) * radius), q, new THREE.Vector3(rs, h, rs));
    ridges.setMatrixAt(i, m);
  }
  ridges.castShadow = false; finalizeInstancedMesh(ridges); group.add(ridges);
  return group;
}

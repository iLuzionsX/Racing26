import * as THREE from 'three';

export function makeSeededRandom(seed: number): () => number {
  let v = seed >>> 0;
  return () => {
    v = (Math.imul(v, 1664525) + 1013904223) >>> 0;
    return v / 0x100000000;
  };
}

const JACKETS = [0xd64545, 0x3b82f6, 0xf59e0b, 0x10b981, 0xe5e7eb, 0x111827, 0x8b5cf6, 0xec4899, 0x22d3ee, 0xf97316];
const SKIN = [0xf1c9a5, 0xe0ac69, 0xc68642, 0x8d5524, 0xffdbac];

export interface CrowdPlacement { x: number; y: number; z: number; yaw: number; s: number; }

export function makeSeatedGrid(rows: number, cols: number, dx: number, dy: number, dz: number, density: number, rng: () => number): CrowdPlacement[] {
  const out: CrowdPlacement[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (rng() > density) continue;
      const jitter = () => (rng() - 0.5) * 0.12;
      out.push({ x: (c - cols / 2) * dx + jitter(), y: r * dy, z: -r * dz + jitter(), yaw: (rng() - 0.5) * 0.5, s: 0.92 + rng() * 0.16 });
    }
  }
  return out;
}

export function makeStandingRow(count: number, width: number, y: number, z: number, density: number, rng: () => number): CrowdPlacement[] {
  const out: CrowdPlacement[] = [];
  for (let i = 0; i < count; i++) {
    if (rng() > density) continue;
    out.push({ x: (i / Math.max(1, count - 1) - 0.5) * width + (rng() - 0.5) * 0.2, y, z: z + (rng() - 0.5) * 0.4, yaw: (rng() - 0.5) * 0.7, s: 0.92 + rng() * 0.16 });
  }
  return out;
}

export function buildCrowdCluster(placements: CrowdPlacement[], rng: () => number): THREE.Group {
  const g = new THREE.Group();
  g.name = 'crowd-cluster';
  if (placements.length === 0) return g;
  const torsoGeo = new THREE.BoxGeometry(0.42, 0.62, 0.26);
  const headGeo = new THREE.SphereGeometry(0.11, 6, 5);
  const torsoMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
  const headMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
  const torsos = new THREE.InstancedMesh(torsoGeo, torsoMat, placements.length);
  const heads = new THREE.InstancedMesh(headGeo, headMat, placements.length);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const col = new THREE.Color();
  for (let i = 0; i < placements.length; i++) {
    const p = placements[i];
    e.set(0, p.yaw, 0); q.setFromEuler(e);
    m.compose(new THREE.Vector3(p.x, p.y + 0.62 * p.s, p.z), q, new THREE.Vector3(p.s, p.s, p.s));
    torsos.setMatrixAt(i, m);
    torsos.setColorAt(i, col.setHex(JACKETS[Math.floor(rng() * JACKETS.length)]));
    m.compose(new THREE.Vector3(p.x, p.y + 1.05 * p.s, p.z), q, new THREE.Vector3(p.s, p.s, p.s));
    heads.setMatrixAt(i, m);
    heads.setColorAt(i, col.setHex(SKIN[Math.floor(rng() * SKIN.length)]));
  }
  torsos.instanceMatrix.needsUpdate = true;
  heads.instanceMatrix.needsUpdate = true;
  if (torsos.instanceColor) torsos.instanceColor.needsUpdate = true;
  if (heads.instanceColor) heads.instanceColor.needsUpdate = true;
  torsos.castShadow = false; heads.castShadow = false;
  torsos.receiveShadow = false; heads.receiveShadow = false;
  g.add(torsos, heads);
  return g;
}


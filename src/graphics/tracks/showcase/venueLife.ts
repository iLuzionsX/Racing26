import * as THREE from 'three';
import { buildCoveredGrandstand, buildOpenBleacher, buildTerraceStand, buildVipTower } from './grandstands';
import { buildBarrierBanner, buildCameraPlatform, buildCatchFence, buildMarshalPost, buildTent, buildViewingMound } from './tracksideFurniture';
import { makeSeededRandom } from './crowd';

interface VenueSample { center: THREE.Vector3; tangent: THREE.Vector3; lateral: THREE.Vector3; bankedLateral: THREE.Vector3; normal: THREE.Vector3; }
interface VenuePath { sampleAt(u: number): VenueSample; }

function groundY(s: VenueSample, lateral: number): number {
  const roadY = s.center.y + s.bankedLateral.y * lateral - 0.42;
  const abs = Math.abs(lateral);
  if (abs <= 34) return roadY;
  const t = Math.min(1, (abs - 34) / 48);
  const smooth = t * t * (3 - 2 * t);
  return roadY * (1 - smooth);
}

function place(group: THREE.Group, path: VenuePath, u: number, lateral: number, lift: number, obj: THREE.Object3D, faceTrack = true): void {
  const s = path.sampleAt(((u % 1) + 1) % 1);
  const pos = s.center.clone().addScaledVector(s.bankedLateral, lateral);
  pos.y = groundY(s, lateral) + lift;
  const basis = new THREE.Matrix4().makeBasis(s.bankedLateral, s.normal, s.tangent);
  const q = new THREE.Quaternion().setFromRotationMatrix(basis);
  if (faceTrack) q.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(0, lateral > 0 ? -Math.PI / 2 : Math.PI / 2, 0)));
  obj.position.copy(pos); obj.quaternion.copy(q);
  obj.updateMatrix();
  group.add(obj);
}

export function buildVenueLife(group: THREE.Group, path: VenuePath, barrierOffsetM: number, _outerRunoffM: number): void {
  const rng = makeSeededRandom(0xc0ffee);
  const B = barrierOffsetM;
  const sideFor = (u: number, side: number) => side;
  void rng;
  // High-density start/finish: covered stand opposite existing pits + bleacher + VIP.
  place(group, path, 0.985, sideFor(0.985, -1) * (B + 15), 0.1, buildCoveredGrandstand(101, 66, 9, 0.85));
  place(group, path, 0.055, sideFor(0.055, 1) * (B + 11), 0.1, buildOpenBleacher(102, 36, 6, 0.7));
  place(group, path, 0.030, sideFor(0.030, -1) * (B + 30), 0.1, buildVipTower(103, 0.7));
  // Signature corners: bowl, crest, technical, esses.
  place(group, path, 0.20, sideFor(0.20, 1) * (B + 13), 0.1, buildTerraceStand(201, 48, 3, 0.6));
  place(group, path, 0.40, sideFor(0.40, -1) * (B + 14), 0.1, buildOpenBleacher(202, 40, 6, 0.65));
  place(group, path, 0.660, sideFor(0.660, 1) * (B + 12), 0.1, buildTerraceStand(203, 44, 3, 0.6));
  place(group, path, 0.795, sideFor(0.795, -1) * (B + 13), 0.1, buildCoveredGrandstand(204, 52, 7, 0.75));
  place(group, path, 0.860, sideFor(0.860, 1) * (B + 16), 0.1, buildOpenBleacher(205, 30, 5, 0.35));
  // Viewing mounds: sparse standing crowd outside barriers.
  place(group, path, 0.225, sideFor(0.225, -1) * (B + 26), 0, buildViewingMound(301, 16, 3.0));
  place(group, path, 0.690, sideFor(0.690, -1) * (B + 24), 0, buildViewingMound(302, 14, 2.6));
  // Hospitality tents behind paddock (same side as pit lane).
  const tentColors = [0xf8fafc, 0x22d3ee, 0xf59e0b, 0x334155];
  for (let i = 0; i < 4; i++) place(group, path, 0.022 + i * 0.0022, -1 * (B + 30 + (i % 2) * 8), 0.1, buildTent(tentColors[i]));
  // Camera platforms: start, bowl, summit, technical.
  for (const [i, u] of [0.018, 0.20, 0.43, 0.79].entries()) {
    const side = i % 2 === 0 ? 1 : -1;
    place(group, path, u, side * (B + 5), 0.1, buildCameraPlatform());
  }
  // Marshal posts: frequent but tiny, just behind barrier.
  for (let i = 0; i < 10; i++) {
    const u = 0.03 + i * 0.095;
    const side = i % 2 === 0 ? 1 : -1;
    place(group, path, u, side * (B + 1.6), 0.1, buildMarshalPost());
  }
  // Catch fencing only in front of seated zones (keeps runoff visually open elsewhere).
  for (const [u, w] of [[0.985, 78], [0.055, 48], [0.20, 58], [0.40, 52], [0.795, 64]] as const) {
    const side = u === 0.985 || u === 0.40 || u === 0.795 ? (u === 0.055 || u === 0.20 ? 1 : -1) : 1;
    const s = path.sampleAt(u);
    const fence = buildCatchFence(w, 3.2);
    const pos = s.center.clone().addScaledVector(s.bankedLateral, side * (B + 0.9));
    pos.y = groundY(s, side * (B + 0.9)) + 0.1;
    const basis = new THREE.Matrix4().makeBasis(s.bankedLateral, s.normal, s.tangent);
    fence.position.copy(pos);
    fence.quaternion.setFromRotationMatrix(basis);
    group.add(fence);
  }
  // Barrier banners: reused canvas textures, attached to barrier face (still outside runoff).
  const ads: Array<[string, string, string]> = [['MUSE GP', '#111827', '#22d3ee'], ['SHOWCASE', '#f8fafc', '#111827'], ['M5 G90', '#0ea5e9', '#ffffff']];
  for (let i = 0; i < 42; i++) {
    const u = 0.005 + (i / 42) * 0.98;
    const inHotZone = (u < 0.08 || u > 0.96 || (u > 0.17 && u < 0.24) || (u > 0.37 && u < 0.45) || (u > 0.76 && u < 0.84));
    if (!inHotZone && i % 3 !== 0) continue;
    const side = i % 2 === 0 ? 1 : -1;
    const s = path.sampleAt(u);
    const ad = ads[i % ads.length];
    const banner = buildBarrierBanner(ad[0], ad[1], ad[2]);
    const pos = s.center.clone().addScaledVector(s.bankedLateral, side * (B - 0.3));
    pos.y += 0.75;
    banner.position.copy(pos);
    banner.rotation.y = Math.atan2(s.tangent.x, s.tangent.z) + (side > 0 ? -Math.PI / 2 : Math.PI / 2);
    group.add(banner);
  }
}

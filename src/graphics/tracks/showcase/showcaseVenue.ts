import * as THREE from 'three';
import { BARRIER_OFFSET_M, type ShowcaseTrackPath } from '../showcaseCircuit';

// Venue practicals + emissive timing + side-cast shadow moments.
// INVARIANT: nothing is placed inside BARRIER_OFFSET_M; 18m runoff stays clear.
// No shadow-casting point/spot lights. Only emissive + 2 non-shadow fills.
function timingTexture(lines: string[]): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256; canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#060a12'; ctx.fillRect(0, 0, 256, 128);
  ctx.fillStyle = '#22d3ee'; ctx.font = '900 22px system-ui';
  lines.slice(0, 4).forEach((line, i) => ctx.fillText(line, 14, 32 + i * 24));
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function createShowcaseVenue(path: ShowcaseTrackPath): THREE.Group {
  const group = new THREE.Group();
  group.name = 'showcase-venue-lighting';
  const warm = new THREE.MeshStandardMaterial({ color: 0x201a12, emissive: 0xffc98a, emissiveIntensity: 1.6, roughness: 0.6 });
  const cool = new THREE.MeshStandardMaterial({ color: 0x0b1220, emissive: 0x7dd3fc, emissiveIntensity: 1.1, roughness: 0.6 });
  // Pit/garage practical strip: emissive boxes beyond pit wall, no shadows.
  const pit = path.sampleAt(0.025);
  for (let i = -3; i <= 3; i++) {
    const box = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.5, 0.3), i % 2 ? warm : cool);
    box.position.copy(pit.center).addScaledVector(pit.bankedLateral, -(BARRIER_OFFSET_M + 9)).addScaledVector(pit.normal, 3.2);
    box.position.addScaledVector(pit.tangent, i * 18);
    box.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(pit.bankedLateral, pit.normal, pit.tangent));
    group.add(box);
  }
  // Two non-shadow fill lights only (pit + start gantry), low intensity for daylight.
  const pitFill = new THREE.PointLight(0xffd9a0, 18, 55, 1.8);
  pitFill.castShadow = false;
  pitFill.position.copy(pit.center).addScaledVector(pit.bankedLateral, -(BARRIER_OFFSET_M + 10)).addScaledVector(pit.normal, 6);
  group.add(pitFill);
  const start = path.sampleAt(0.018);
  const gantryFill = new THREE.PointLight(0x9fd8ff, 12, 45, 1.8);
  gantryFill.castShadow = false;
  gantryFill.position.copy(start.center).addScaledVector(start.normal, 7);
  group.add(gantryFill);
  // Emissive timing boards (deterministic u + side), face track, MeshBasicMaterial.
  const boards: Array<[string, number, string[]]> = [
    ['T1', 0.20, ['P1  M5  1:32.4', 'P2  +0.4', 'SECTOR 1']],
    ['T2', 0.43, ['SUMMIT', 'GAP 1.1s', 'SECTOR 2']],
    ['T3', 0.80, ['TURN 7', '150 100 50', 'SECTOR 3']],
  ];
  for (const [, u, lines] of boards) {
    const s = path.sampleAt(u);
    const mat = new THREE.MeshBasicMaterial({ map: timingTexture(lines) });
    const board = new THREE.Mesh(new THREE.PlaneGeometry(7, 3.5), mat);
    board.position.copy(s.center).addScaledVector(s.lateral, BARRIER_OFFSET_M + 6);
    board.position.y += 4.5;
    board.rotation.y = Math.atan2(s.tangent.x, s.tangent.z) - Math.PI / 2;
    group.add(board);
  }
  // Tunnel-like shadow moments WITHOUT track-cover geometry: tall side pylons
  // whose sun shadows sweep the road briefly. All bases beyond barrier + 8m.
  const pylonMat = new THREE.MeshStandardMaterial({ color: 0x1f2937, roughness: 0.9 });
  const pylonGeo = new THREE.BoxGeometry(1.4, 26, 1.4);
  for (const u of [0.56, 0.585, 0.61]) {
    const s = path.sampleAt(u);
    for (const side of [-1, 1]) {
      const pylon = new THREE.Mesh(pylonGeo, pylonMat);
      pylon.position.copy(s.center).addScaledVector(s.lateral, side * (BARRIER_OFFSET_M + 9));
      pylon.position.y += 10;
      pylon.castShadow = true;
      pylon.receiveShadow = false;
      group.add(pylon);
    }
  }
  return group;
}

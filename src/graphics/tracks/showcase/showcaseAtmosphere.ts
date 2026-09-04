import * as THREE from 'three';

// Sky/fog/haze only. No geometry over the racing corridor. Cheap by design:
// one gradient dome (BackSide, fog:false) + tuned FogExp2 + 3 large haze quads.
export function createShowcaseAtmosphere(scene: THREE.Scene, trackCenterX = 560): THREE.Group {
  const group = new THREE.Group();
  group.name = 'showcase-atmosphere';
  scene.background = new THREE.Color(0x87a8bd);
  scene.fog = new THREE.FogExp2(0x87a8bd, 0.00115);
  const skyGeo = new THREE.SphereGeometry(950, 24, 12);
  const top = new THREE.Color(0x6fa8d6);
  const mid = new THREE.Color(0x9fc3d8);
  const bot = new THREE.Color(0xc8d8e2);
  const pos = skyGeo.getAttribute('position');
  const colors = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i) / 950;
    if (y > 0.25) c.copy(mid).lerp(top, Math.min(1, (y - 0.25) / 0.5));
    else c.copy(bot).lerp(mid, Math.max(0, (y + 0.2) / 0.45));
    colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
  }
  skyGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const skyMat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false });
  const sky = new THREE.Mesh(skyGeo, skyMat);
  sky.position.set(trackCenterX, 40, 0);
  sky.renderOrder = -10;
  group.add(sky);
  const hazeMat = new THREE.MeshBasicMaterial({ color: 0xbdd2e2, transparent: true, opacity: 0.10, depthWrite: false, fog: false });
  for (let i = 0; i < 3; i++) {
    const haze = new THREE.Mesh(new THREE.PlaneGeometry(700, 60), hazeMat);
    haze.position.set(trackCenterX + (i - 1) * 220, 26 + i * 9, -320 + i * 180);
    haze.rotation.y = Math.PI / 8 + i * 0.2;
    haze.renderOrder = 2;
    group.add(haze);
  }
  return group;
}

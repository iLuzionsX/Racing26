import * as THREE from 'three';
import { buildCrowdCluster, makeSeededRandom, makeStandingRow } from './crowd';

const texCache = new Map<string, THREE.CanvasTexture>();
export function bannerTexture(text: string, bg: string, fg: string): THREE.CanvasTexture {
  const key = text + '|' + bg + '|' + fg;
  const hit = texCache.get(key);
  if (hit) return hit;
  const c = document.createElement('canvas'); c.width = 512; c.height = 96;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = bg; ctx.fillRect(0, 0, 512, 96);
  ctx.fillStyle = fg; ctx.font = '900 52px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(text, 256, 50);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  texCache.set(key, t); return t;
}

export function buildBarrierBanner(text: string, bg: string, fg: string): THREE.Mesh {
  const mat = new THREE.MeshBasicMaterial({ map: bannerTexture(text, bg, fg), side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(6, 0.9), mat);
  mesh.name = 'barrier-banner';
  return mesh;
}

export function buildCatchFence(widthM: number, heightM = 3.2): THREE.Group {
  const g = new THREE.Group(); g.name = 'catch-fence';
  const postGeo = new THREE.CylinderGeometry(0.06, 0.06, heightM, 6);
  const postMat = new THREE.MeshStandardMaterial({ color: 0x475569, roughness: 0.6, metalness: 0.5 });
  const n = Math.max(2, Math.floor(widthM / 8) + 1);
  const posts = new THREE.InstancedMesh(postGeo, postMat, n);
  const m = new THREE.Matrix4();
  for (let i = 0; i < n; i++) { m.makeTranslation(-widthM / 2 + (widthM * i) / (n - 1), heightM / 2, 0); posts.setMatrixAt(i, m); }
  posts.instanceMatrix.needsUpdate = true; posts.castShadow = false;
  g.add(posts);
  const netMat = new THREE.MeshBasicMaterial({ color: 0x64748b, transparent: true, opacity: 0.28, side: THREE.DoubleSide, depthWrite: false });
  const net = new THREE.Mesh(new THREE.PlaneGeometry(widthM, heightM - 0.4), netMat);
  net.position.y = heightM / 2; g.add(net);
  const rail = new THREE.Mesh(new THREE.BoxGeometry(widthM, 0.08, 0.08), postMat);
  rail.position.y = heightM; g.add(rail);
  return g;
}

export function buildCameraPlatform(): THREE.Group {
  const g = new THREE.Group(); g.name = 'camera-platform';
  const steel = new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.55, metalness: 0.5 });
  for (const sx of [-1.1, 1.1]) for (const sz of [-1.1, 1.1]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.18, 6.2, 0.18), steel);
    leg.position.set(sx, 3.1, sz); leg.castShadow = true; g.add(leg);
  }
  const deck = new THREE.Mesh(new THREE.BoxGeometry(3.0, 0.25, 3.0), steel);
  deck.position.y = 6.3; deck.castShadow = true; g.add(deck);
  const cam = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.45, 1.0), new THREE.MeshStandardMaterial({ color: 0x111827, roughness: 0.4 }));
  cam.position.set(0, 7.0, 0.6); g.add(cam);
  const hood = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.15, 3.2), new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.7 }));
  hood.position.y = 7.8; g.add(hood);
  return g;
}

export function buildMarshalPost(): THREE.Group {
  const g = new THREE.Group(); g.name = 'marshal-post';
  const hut = new THREE.Mesh(new THREE.BoxGeometry(2.4, 2.3, 2.0), new THREE.MeshStandardMaterial({ color: 0xf97316, roughness: 0.7 }));
  hut.position.y = 1.15; hut.castShadow = true; g.add(hut);
  const roof = new THREE.Mesh(new THREE.BoxGeometry(2.8, 0.18, 2.4), new THREE.MeshStandardMaterial({ color: 0x1f2937, roughness: 0.7 }));
  roof.position.y = 2.4; g.add(roof);
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 3.4, 6), new THREE.MeshStandardMaterial({ color: 0xe5e7eb }));
  pole.position.set(1.5, 1.7, 0.8); g.add(pole);
  const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.45), new THREE.MeshBasicMaterial({ color: 0xfacc15, side: THREE.DoubleSide }));
  flag.position.set(1.9, 3.0, 0.8); g.add(flag);
  return g;
}

export function buildTent(colorHex: number): THREE.Group {
  const g = new THREE.Group(); g.name = 'hospitality-tent';
  const fabric = new THREE.MeshStandardMaterial({ color: colorHex, roughness: 0.8 });
  const poleMat = new THREE.MeshStandardMaterial({ color: 0xe5e7eb, roughness: 0.5 });
  for (const sx of [-2.4, 2.4]) for (const sz of [-2.4, 2.4]) {
    const p = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 2.6, 6), poleMat);
    p.position.set(sx, 1.3, sz); g.add(p);
  }
  const roof = new THREE.Mesh(new THREE.ConeGeometry(3.8, 1.4, 4), fabric);
  roof.position.y = 3.3; roof.rotation.y = Math.PI / 4; roof.castShadow = true; g.add(roof);
  return g;
}

export function buildViewingMound(seed: number, radiusM = 16, heightM = 3.2): THREE.Group {
  const g = new THREE.Group(); g.name = 'viewing-mound';
  const grass = new THREE.MeshStandardMaterial({ color: 0x5b7a45, roughness: 1 });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(radiusM, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2.6), grass);
  dome.scale.y = heightM / radiusM; dome.receiveShadow = true; g.add(dome);
  const rng = makeSeededRandom(seed);
  const crowd = makeStandingRow(34, radiusM * 1.1, heightM * 0.72, 2.2, 0.4, rng);
  g.add(buildCrowdCluster(crowd, rng));
  return g;
}


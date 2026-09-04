import * as THREE from 'three';
import { buildCrowdCluster, makeSeatedGrid, makeSeededRandom, makeStandingRow } from './crowd';

const concreteMat = new THREE.MeshStandardMaterial({ color: 0x9aa3ad, roughness: 0.9 });
const darkMat = new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.6, metalness: 0.4 });
const roofRed = new THREE.MeshStandardMaterial({ color: 0xb91c1c, roughness: 0.55, metalness: 0.2 });
const roofWhite = new THREE.MeshStandardMaterial({ color: 0xe2e8f0, roughness: 0.6, metalness: 0.15 });
const glassMat = new THREE.MeshStandardMaterial({ color: 0x0ea5e9, roughness: 0.15, metalness: 0.5 });

function box(w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  mesh.position.set(x, y, z);
  mesh.castShadow = true; mesh.receiveShadow = true;
  return mesh;
}

export function buildCoveredGrandstand(seed: number, widthM = 64, rows = 9, density = 0.8): THREE.Group {
  const g = new THREE.Group(); g.name = 'covered-grandstand';
  const rng = makeSeededRandom(seed);
  for (let r = 0; r < rows; r++) g.add(box(widthM, 0.85, 1.9, concreteMat, 0, 0.5 + r * 0.85, -r * 1.7));
  g.add(box(widthM + 2, 0.4, 1.2, darkMat, 0, rows * 0.85 + 0.4, -rows * 1.7));
  for (const sx of [-widthM / 2 + 1, widthM / 2 - 1]) {
    const pole = box(0.35, 7.5, 0.35, darkMat, sx, 4.2, 1.2); g.add(pole);
  }
  const roof = box(widthM + 4, 0.35, rows * 1.7 + 5, roofRed, 0, 8.0, -rows * 0.85 + 0.5);
  roof.rotation.x = 0.10; g.add(roof);
  g.add(box(widthM, 1.0, 0.25, darkMat, 0, 0.7, 1.6));
  const placements = makeSeatedGrid(rows, Math.floor(widthM / 1.1), 1.05, 0.85, 1.7, density, rng);
  placements.forEach((p) => { p.y += 1.15; p.z += 0.4; });
  g.add(buildCrowdCluster(placements, rng));
  return g;
}

export function buildOpenBleacher(seed: number, widthM = 34, rows = 6, density = 0.65): THREE.Group {
  const g = new THREE.Group(); g.name = 'open-bleacher';
  const rng = makeSeededRandom(seed);
  for (let r = 0; r < rows; r++) g.add(box(widthM, 0.6, 1.5, concreteMat, 0, 0.35 + r * 0.62, -r * 1.35));
  g.add(box(2.2, 0.5, rows * 1.5, darkMat, -widthM / 2 - 1, 0.4, -rows * 0.65));
  g.add(box(2.2, 0.5, rows * 1.5, darkMat, widthM / 2 + 1, 0.4, -rows * 0.65));
  const placements = makeSeatedGrid(rows, Math.floor(widthM / 1.15), 1.1, 0.62, 1.35, density, rng);
  placements.forEach((p) => { p.y += 0.85; p.z += 0.3; });
  g.add(buildCrowdCluster(placements, rng));
  return g;
}

export function buildTerraceStand(seed: number, widthM = 46, rows = 3, density = 0.55): THREE.Group {
  const g = new THREE.Group(); g.name = 'terrace-stand';
  const rng = makeSeededRandom(seed);
  for (let r = 0; r < rows; r++) g.add(box(widthM, 0.55, 2.6, concreteMat, 0, 0.3 + r * 0.55, -r * 2.4));
  const rail = box(widthM, 0.08, 0.08, darkMat, 0, 1.35, 1.1); rail.castShadow = false; g.add(rail);
  for (let i = 0; i <= 10; i++) g.add(box(0.08, 1.1, 0.08, darkMat, -widthM / 2 + (widthM * i) / 10, 0.8, 1.1));
  const placements = makeStandingRow(Math.floor(widthM / 0.9), widthM, 0.55, 0.6, density, rng);
  g.add(buildCrowdCluster(placements, rng));
  return g;
}

export function buildVipTower(seed: number, density = 0.7): THREE.Group {
  const g = new THREE.Group(); g.name = 'vip-tower';
  const rng = makeSeededRandom(seed);
  g.add(box(22, 3.4, 10, concreteMat, 0, 1.7, -5));
  g.add(box(22, 2.6, 10, roofWhite, 0, 4.7, -5));
  const glass = box(21, 1.4, 0.2, glassMat, 0, 4.9, 0.1); glass.castShadow = false; g.add(glass);
  g.add(box(24, 0.4, 12, darkMat, 0, 6.3, -5));
  g.add(box(24, 1.0, 0.2, darkMat, 0, 6.9, 0.8));
  const deck = makeStandingRow(26, 21, 6.5, -4.2, density, rng);
  g.add(buildCrowdCluster(deck, rng));
  return g;
}


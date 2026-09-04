import * as THREE from 'three';

// Daylight-first key/fill balance. Road must stay readable; no exposure tricks.
// Single shadow-casting directional only. Everything else is emissive/unlit.
export interface ShowcaseLightingRig {
  hemi: THREE.HemisphereLight;
  sun: THREE.DirectionalLight;
}

export function createShowcaseLightingRig(isMobile: boolean, trackCenterX = 560): ShowcaseLightingRig {
  const hemi = new THREE.HemisphereLight(0xcfe8ff, 0x2c3324, 0.85);
  const sun = new THREE.DirectionalLight(0xfff1d6, 2.0);
  sun.position.set(trackCenterX + 180, 230, -150);
  sun.castShadow = true;
  const size = isMobile ? 1024 : 2048;
  sun.shadow.mapSize.set(size, size);
  sun.shadow.camera.left = -320;
  sun.shadow.camera.right = 320;
  sun.shadow.camera.top = 320;
  sun.shadow.camera.bottom = -320;
  sun.shadow.camera.near = 20;
  sun.shadow.camera.far = 700;
  sun.shadow.bias = -0.0004;
  return { hemi, sun };
}

export function isMobileGpu(): boolean {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;
  const coarse = window.matchMedia?.('(pointer: coarse)').matches ?? false;
  const small = window.innerWidth <= 1180;
  return coarse && small;
}

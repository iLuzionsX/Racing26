import * as THREE from 'three';
import type { ShowcaseTrackPath } from '../showcaseCircuit';
import { createShowcaseLightingRig, isMobileGpu } from './showcaseLighting';
import { createShowcaseAtmosphere } from './showcaseAtmosphere';
import { createShowcaseVenue } from './showcaseVenue';

// Composer keeps geometry/surface/spawn untouched; lighting/atmosphere/venue only.
export function applyShowcaseLook(scene: THREE.Scene, trackGroup: THREE.Group, path: ShowcaseTrackPath): void {
  const rig = createShowcaseLightingRig(isMobileGpu());
  trackGroup.add(rig.hemi, rig.sun);
  trackGroup.add(createShowcaseAtmosphere(scene));
  trackGroup.add(createShowcaseVenue(path));
}

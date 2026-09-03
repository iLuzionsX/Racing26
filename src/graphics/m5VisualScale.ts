import * as THREE from 'three';
import { BMW_M5_G90_LENGTH_M } from './worldScale';

export interface VisualScaleReport {
  sourceLengthM: number;
  sourceWidthM: number;
  sourceHeightM: number;
  appliedScale: number;
  finalLengthM: number;
  finalWidthM: number;
  finalHeightM: number;
}

function dimensionsFor(root: THREE.Object3D) {
  root.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(root);
  const size = new THREE.Vector3();
  bounds.getSize(size);
  return { lengthM: size.z, widthM: size.x, heightM: size.y };
}

/**
 * Keep the bundled G90 visual in literal metres. Assetto Corsa content is normally
 * metre-authored, but this guard prevents an export/conversion scale from making the
 * body look too large or too small relative to physics, road markings, and camera.
 * Length is the most stable reference because mirrors/aero can alter width bounds.
 */
export function fitM5VisualToRealScale(root: THREE.Group): VisualScaleReport {
  const source = dimensionsFor(root);
  const validLength = Number.isFinite(source.lengthM) && source.lengthM > 0.1;
  const rawScale = validLength ? BMW_M5_G90_LENGTH_M / source.lengthM : 1;
  const candidateScale = Number.isFinite(rawScale) && rawScale >= 0.5 && rawScale <= 2 ? rawScale : 1;

  // Ignore sub-0.25% export noise. `appliedScale` reports the transform that was
  // actually applied, not merely the candidate factor considered by the guard.
  const appliedScale = Math.abs(candidateScale - 1) > 0.0025 ? candidateScale : 1;
  if (appliedScale !== 1) {
    root.scale.multiplyScalar(appliedScale);
    root.updateMatrixWorld(true);
  }

  const finalSize = dimensionsFor(root);
  return {
    sourceLengthM: source.lengthM,
    sourceWidthM: source.widthM,
    sourceHeightM: source.heightM,
    appliedScale,
    finalLengthM: finalSize.lengthM,
    finalWidthM: finalSize.widthM,
    finalHeightM: finalSize.heightM,
  };
}

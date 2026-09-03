import type { CameraMode } from '../types';

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

export function horizontalFovForVertical(verticalFovDeg: number, aspect: number): number {
  const safeAspect = Math.max(0.1, aspect || 1);
  const verticalRad = (verticalFovDeg * Math.PI) / 180;
  return (2 * Math.atan(Math.tan(verticalRad / 2) * safeAspect) * 180) / Math.PI;
}

export function verticalFovForHorizontal(horizontalFovDeg: number, aspect: number): number {
  const safeAspect = Math.max(0.1, aspect || 1);
  const horizontalRad = (horizontalFovDeg * Math.PI) / 180;
  return (2 * Math.atan(Math.tan(horizontalRad / 2) / safeAspect) * 180) / Math.PI;
}

/**
 * Author the driving cameras in horizontal FOV so a 16:9, 21:9, or mobile viewport
 * shows the same world-scale perspective. Three.js stores vertical FOV, so callers
 * convert this result through verticalFovForHorizontal().
 */
export function targetHorizontalFov(mode: CameraMode, speedKmh: number): number {
  const speedT = clamp01(speedKmh / 200);

  switch (mode) {
    case 'chase':
      return 80 + 8 * speedT;
    case 'close':
      return 76 + 8 * speedT;
    case 'hood':
      return 82 + 10 * speedT;
    case 'cockpit':
      return 78 + 6 * speedT;
    case 'drift':
      return 86;
    case 'orbit':
      return 72;
    default:
      return 80;
  }
}

export function targetVerticalFov(mode: CameraMode, speedKmh: number, aspect: number): number {
  return verticalFovForHorizontal(targetHorizontalFov(mode, speedKmh), aspect);
}

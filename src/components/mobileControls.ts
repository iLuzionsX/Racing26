export type MobileSteeringDirection = 'left' | 'right';
export type MobileSteeringAction = 'steerLeft' | 'steerRight';

export const MOBILE_STEERING_WHEEL_DEFAULT_ROTATION_DEG = 900;
export const MOBILE_STEERING_WHEEL_MIN_ROTATION_DEG = 360;
export const MOBILE_STEERING_WHEEL_MAX_ROTATION_DEG = 1080;
export const MOBILE_STEERING_WHEEL_DEADZONE_DEG = 3;
export const MOBILE_STEERING_ROTATION_STORAGE_KEY = 'racing26.mobileControls.steeringRotation.v1';

/**
 * Backward-compatible one-way default wheel travel.
 * 900 deg lock-to-lock => +/-450 deg from center.
 */
export const MOBILE_STEERING_WHEEL_MAX_DEG = MOBILE_STEERING_WHEEL_DEFAULT_ROTATION_DEG / 2;

export interface MobileSteeringStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function sanitizeMobileSteeringRotationDeg(
  value: unknown,
  fallback = MOBILE_STEERING_WHEEL_DEFAULT_ROTATION_DEG
): number {
  const fallbackValue = Number.isFinite(fallback)
    ? Number(fallback)
    : MOBILE_STEERING_WHEEL_DEFAULT_ROTATION_DEG;
  const numeric =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim()
        ? Number(value)
        : fallbackValue;
  if (!Number.isFinite(numeric)) return sanitizeMobileSteeringRotationDeg(fallbackValue);
  return Math.max(
    MOBILE_STEERING_WHEEL_MIN_ROTATION_DEG,
    Math.min(MOBILE_STEERING_WHEEL_MAX_ROTATION_DEG, numeric)
  );
}

export function mobileWheelMaxRotationDeg(
  steeringRotationDeg = MOBILE_STEERING_WHEEL_DEFAULT_ROTATION_DEG
): number {
  return sanitizeMobileSteeringRotationDeg(steeringRotationDeg) / 2;
}

const browserStorage = (): MobileSteeringStorageLike | null => {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
};

export function loadMobileSteeringRotationDeg(
  storage: MobileSteeringStorageLike | null = browserStorage()
): number {
  try {
    return sanitizeMobileSteeringRotationDeg(
      storage?.getItem(MOBILE_STEERING_ROTATION_STORAGE_KEY)
    );
  } catch {
    return MOBILE_STEERING_WHEEL_DEFAULT_ROTATION_DEG;
  }
}

export function saveMobileSteeringRotationDeg(
  rotationDeg: number,
  storage: MobileSteeringStorageLike | null = browserStorage()
): number {
  const sanitized = sanitizeMobileSteeringRotationDeg(rotationDeg);
  try {
    storage?.setItem(MOBILE_STEERING_ROTATION_STORAGE_KEY, String(sanitized));
  } catch {
    // Storage failures must never affect steering.
  }
  return sanitized;
}

/**
 * Legacy explicit mapping remains for regression coverage and compatibility
 * with older touch-control callers.
 */
export function mapMobileSteeringDirection(direction: MobileSteeringDirection): MobileSteeringAction {
  return direction === 'left' ? 'steerLeft' : 'steerRight';
}

export function clampMobileWheelRotationDeg(
  rotationDeg: number,
  steeringRotationDeg = MOBILE_STEERING_WHEEL_DEFAULT_ROTATION_DEG
): number {
  if (!Number.isFinite(rotationDeg)) return 0;
  const maxRotation = mobileWheelMaxRotationDeg(steeringRotationDeg);
  return Math.max(-maxRotation, Math.min(maxRotation, rotationDeg));
}

/** Normalize to (-180, 180]. */
export function wrapAngleDeg(angleDeg: number): number {
  if (!Number.isFinite(angleDeg)) return 0;
  let wrapped = ((angleDeg + 180) % 360 + 360) % 360 - 180;
  if (wrapped === -180) wrapped = 180;
  return wrapped;
}

/**
 * Pointer angle around a wheel center: 0 = top, clockwise = positive.
 * This matches CSS rotate() direction and makes visual rotation intuitive.
 */
export function mobileWheelPointerAngleDeg(
  centerX: number,
  centerY: number,
  clientX: number,
  clientY: number
): number {
  return Math.atan2(clientX - centerX, -(clientY - centerY)) * 180 / Math.PI;
}

/**
 * Preserve the point on the rim where the driver grabbed the wheel so the
 * visual/input angle does not jump on pointer-down.
 */
export function mobileWheelGrabOffsetDeg(pointerAngleDeg: number, wheelRotationDeg: number): number {
  return wrapAngleDeg(pointerAngleDeg - wheelRotationDeg);
}

export function resolveMobileWheelRotationDeg(
  pointerAngleDeg: number,
  grabOffsetDeg: number,
  steeringRotationDeg = MOBILE_STEERING_WHEEL_DEFAULT_ROTATION_DEG
): number {
  return clampMobileWheelRotationDeg(
    wrapAngleDeg(pointerAngleDeg - grabOffsetDeg),
    steeringRotationDeg
  );
}

/**
 * Canonical vehicle convention: positive steer = LEFT. CSS clockwise rotation
 * is positive, therefore counter-clockwise wheel rotation maps to +steer.
 *
 * The default 900-degree lock-to-lock travel intentionally gives the mobile
 * wheel road-car-like hand travel instead of mapping a quarter-turn directly
 * to the M5's mechanical rack stop. Full rack authority remains available.
 */
export function mobileWheelRotationToSteer(
  rotationDeg: number,
  steeringRotationDeg = MOBILE_STEERING_WHEEL_DEFAULT_ROTATION_DEG
): number {
  const maxRotation = mobileWheelMaxRotationDeg(steeringRotationDeg);
  const rotation = clampMobileWheelRotationDeg(rotationDeg, steeringRotationDeg);
  const magnitude = Math.abs(rotation);
  if (magnitude <= MOBILE_STEERING_WHEEL_DEADZONE_DEG) return 0;
  const usable = Math.max(1, maxRotation - MOBILE_STEERING_WHEEL_DEADZONE_DEG);
  const normalized = Math.min(1, (magnitude - MOBILE_STEERING_WHEEL_DEADZONE_DEG) / usable);
  return -Math.sign(rotation) * normalized;
}

export function mobileWheelSteerToRotationDeg(
  steer: number,
  steeringRotationDeg = MOBILE_STEERING_WHEEL_DEFAULT_ROTATION_DEG
): number {
  if (!Number.isFinite(steer)) return 0;
  return -Math.max(-1, Math.min(1, steer)) * mobileWheelMaxRotationDeg(steeringRotationDeg);
}

/**
 * Incremental angular update avoids the atan2 seam: moving from +179° to -179°
 * is a +2° continuation, not a full-lock reversal. Accumulation also supports
 * multi-turn 720-1080 degree steering wheels while pointer capture stays active.
 */
export function advanceMobileWheelRotationDeg(
  rotationDeg: number,
  previousPointerAngleDeg: number,
  pointerAngleDeg: number,
  steeringRotationDeg = MOBILE_STEERING_WHEEL_DEFAULT_ROTATION_DEG
): number {
  const deltaDeg = wrapAngleDeg(pointerAngleDeg - previousPointerAngleDeg);
  return clampMobileWheelRotationDeg(rotationDeg + deltaDeg, steeringRotationDeg);
}

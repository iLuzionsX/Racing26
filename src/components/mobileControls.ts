export type MobileSteeringDirection = 'left' | 'right';
export type MobileSteeringAction = 'steerLeft' | 'steerRight';

export const MOBILE_STEERING_WHEEL_MAX_DEG = 135;
export const MOBILE_STEERING_WHEEL_DEADZONE_DEG = 3;

/**
 * Legacy explicit mapping remains for regression coverage and compatibility
 * with older touch-control callers.
 */
export function mapMobileSteeringDirection(direction: MobileSteeringDirection): MobileSteeringAction {
  return direction === 'left' ? 'steerLeft' : 'steerRight';
}

export function clampMobileWheelRotationDeg(rotationDeg: number): number {
  if (!Number.isFinite(rotationDeg)) return 0;
  return Math.max(-MOBILE_STEERING_WHEEL_MAX_DEG, Math.min(MOBILE_STEERING_WHEEL_MAX_DEG, rotationDeg));
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

export function resolveMobileWheelRotationDeg(pointerAngleDeg: number, grabOffsetDeg: number): number {
  return clampMobileWheelRotationDeg(wrapAngleDeg(pointerAngleDeg - grabOffsetDeg));
}

/**
 * Canonical vehicle convention: positive steer = LEFT. CSS clockwise rotation
 * is positive, therefore counter-clockwise wheel rotation maps to +steer.
 */
export function mobileWheelRotationToSteer(rotationDeg: number): number {
  const rotation = clampMobileWheelRotationDeg(rotationDeg);
  const magnitude = Math.abs(rotation);
  if (magnitude <= MOBILE_STEERING_WHEEL_DEADZONE_DEG) return 0;
  const usable = MOBILE_STEERING_WHEEL_MAX_DEG - MOBILE_STEERING_WHEEL_DEADZONE_DEG;
  const normalized = Math.min(1, (magnitude - MOBILE_STEERING_WHEEL_DEADZONE_DEG) / usable);
  return -Math.sign(rotation) * normalized;
}

export function mobileWheelSteerToRotationDeg(steer: number): number {
  if (!Number.isFinite(steer)) return 0;
  return -Math.max(-1, Math.min(1, steer)) * MOBILE_STEERING_WHEEL_MAX_DEG;
}

/**
 * Incremental angular update avoids the atan2 seam: moving from +179° to -179°
 * is a +2° continuation, not a full-lock reversal.
 */
export function advanceMobileWheelRotationDeg(
  rotationDeg: number,
  previousPointerAngleDeg: number,
  pointerAngleDeg: number
): number {
  const deltaDeg = wrapAngleDeg(pointerAngleDeg - previousPointerAngleDeg);
  return clampMobileWheelRotationDeg(rotationDeg + deltaDeg);
}

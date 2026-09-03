import { PhysicsMath } from './math/PhysicsMath';

export type SteeringInputMode = 'keyboard' | 'mouse';

/**
 * Convert horizontal pointer position into the simulator steering convention.
 * Canonical input sign is +LEFT / -RIGHT, so the left edge maps to +1.
 * A small center deadzone makes it easy to hold the car straight.
 */
export function mouseSteeringFromClientX(
  clientX: number,
  canvasLeft: number,
  canvasWidth: number,
  deadzone = 0.04
): number {
  if (!Number.isFinite(clientX) || !Number.isFinite(canvasLeft) || canvasWidth <= 0) return 0;

  const centerX = canvasLeft + canvasWidth * 0.5;
  const halfWidth = Math.max(1, canvasWidth * 0.5);
  // Screen X increases to the right, while simulator positive steer means LEFT.
  const raw = PhysicsMath.clamp((centerX - clientX) / halfWidth, -1, 1);
  const absRaw = Math.abs(raw);
  const dz = PhysicsMath.clamp(deadzone, 0, 0.35);

  if (absRaw <= dz) return 0;

  // Re-expand the usable range after the deadzone so reaching an edge still
  // gives true +/-1 mechanical steering input.
  const scaled = (absRaw - dz) / Math.max(1e-6, 1 - dz);
  return Math.sign(raw) * PhysicsMath.clamp(scaled, 0, 1);
}

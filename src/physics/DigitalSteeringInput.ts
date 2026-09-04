import { PhysicsMath } from './math/PhysicsMath';

/**
 * Binary steering has no physical hand travel, so its wind-on rate has to stand
 * in for the driver's hands. Keep parking response quick, then slow ordinary
 * turn-in progressively with road speed. This changes only input velocity:
 * mechanical rack stops and opposite-lock authority remain untouched.
 */
export function digitalSteerWindRatePerSecond(speedMs: number): number {
  const speed = Number.isFinite(speedMs) ? Math.abs(speedMs) : 0;
  const clamped = PhysicsMath.clamp(speed, 0, 55);
  // 4.8/s at rest -> ~1.4/s by 198 km/h. Release and reversal use the separate
  // fast path below, so catching a slide is not sacrificed to calm turn-in.
  return Math.max(1.4, 4.8 - clamped * 0.068);
}

/**
 * Keyboard/touch-button inputs are binary. A held button may still reach the
 * full mechanical rack, but it must not inject parking-lot steering velocity
 * into a 100-180 km/h turn.
 */
export function updateDigitalSteeringInput(
  currentInput: number,
  direction: -1 | 0 | 1,
  speedMs: number,
  dt: number
): number {
  const current = PhysicsMath.clamp(Number.isFinite(currentInput) ? currentInput : 0, -1, 1);
  if (dt <= 0) return current;

  const target = direction;
  const reversingDirection =
    direction !== 0 &&
    Math.sign(current) !== 0 &&
    Math.sign(target) !== Math.sign(current);
  const ratePerSecond =
    direction === 0 || reversingDirection
      ? 7.0
      : digitalSteerWindRatePerSecond(speedMs);
  const maxStep = ratePerSecond * dt;
  const error = target - current;

  if (Math.abs(error) <= maxStep) return target;
  return PhysicsMath.clamp(current + Math.sign(error) * maxStep, -1, 1);
}

/**
 * Rate-limit a continuous analog rack-fraction target (-1..1).
 *
 * The on-screen wheel and mouse already encode hand position, but previously
 * their target could jump directly into the rack in a single render frame.
 * That let a quick finger/pointer motion create an impossible high-speed
 * steering impulse. Full travel remains available; only the velocity of the
 * applied command is made physical and mirrored.
 */
export function slewAnalogSteeringInput(
  currentInput: number,
  targetInput: number,
  speedMs: number,
  dt: number
): number {
  const current = PhysicsMath.clamp(Number.isFinite(currentInput) ? currentInput : 0, -1, 1);
  const target = PhysicsMath.clamp(Number.isFinite(targetInput) ? targetInput : 0, -1, 1);
  if (dt <= 0) return current;

  const error = target - current;
  if (Math.abs(error) <= 1e-12) return target;

  const reversingDirection =
    target !== 0 &&
    Math.sign(current) !== 0 &&
    Math.sign(target) !== Math.sign(current);
  const towardCenter =
    target === 0 ||
    Math.abs(target) < Math.abs(current);

  // Let the driver unwind/countersteer rapidly; only ordinary wind-on becomes
  // progressively calmer with speed.
  const ratePerSecond =
    towardCenter || reversingDirection
      ? 7.0
      : digitalSteerWindRatePerSecond(speedMs);
  const maxStep = ratePerSecond * dt;

  if (Math.abs(error) <= maxStep) return target;
  return PhysicsMath.clamp(current + Math.sign(error) * maxStep, -1, 1);
}

import { PhysicsMath } from './math/PhysicsMath';

/**
 * Binary keyboard/touch steering as human hand-wheel emulation.
 *
 * The physical rack in DriverAids retains full mechanical travel at all road
 * speeds for every input device (including mouse/wheel analog). This helper
 * only shapes how fast a binary key/button can move the driver hand-wheel
 * request toward full lock, emulating roughly constant human hand speed passed
 * through speed-sensitive variable-ratio assistance: road-wheel rate falls with
 * road speed while sustained full hand-wheel (+/-1) remains reachable.
 *
 * This function inspects only input history, road speed magnitude, and dt.
 * It never inspects yaw, sideslip, tire state, or vehicle motion and never
 * adds forces. Left/right behavior is exactly symmetric by construction.
 * Release and reversal (countersteer/correction) stay fast so oversteer
 * recovery authority is preserved; only wind-on (increasing lock from center
 * or same-sign) is slowed at speed to keep front slip near peak on turn-in.
 */
export function digitalWindOnRatePerSecond(speedMs: number): number {
  const absSpeed = Number.isFinite(speedMs) ? Math.abs(speedMs) : 0;
  const speedScale = Math.pow(absSpeed / 12, 1.2);
  // 4.8/s at rest matches prior parking behavior; >=1.0/s guarantees a held
  // key still reaches full driver request within 1 s even at autobahn speed.
  return Math.max(1.0, 4.8 / (1 + speedScale));
}

export function updateDigitalSteeringInput(
  currentInput: number,
  direction: -1 | 0 | 1,
  speedMs: number,
  dt: number
): number {
  if (dt <= 0) return PhysicsMath.clamp(currentInput, -1, 1);

  const target = direction;

  // Fast return and fast reversal: driver can throw the wheel back through
  // center faster than they normally wind into a corner.
  const reversingDirection =
    direction !== 0 && Math.sign(currentInput) !== 0 && Math.sign(target) !== Math.sign(currentInput);
  const releasing = direction === 0;
  const ratePerSecond =
    releasing || reversingDirection ? 7.0 : digitalWindOnRatePerSecond(speedMs);
  const maxStep = ratePerSecond * dt;
  const error = target - currentInput;

  if (Math.abs(error) <= maxStep) return target;
  return PhysicsMath.clamp(currentInput + Math.sign(error) * maxStep, -1, 1);
}

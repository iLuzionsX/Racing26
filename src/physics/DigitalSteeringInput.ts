import { PhysicsMath } from './math/PhysicsMath';

/**
 * Keyboard/touch inputs are binary, so they still need a steering-rate adapter.
 * They must NOT lose steering authority, though: the physical rack in DriverAids
 * already applies its own road-speed steering geometry/rate. A second amplitude
 * cap here used to make high-speed countersteer physically unreachable.
 *
 * Full left/right therefore always means a full driver request (+/-1). This helper
 * only slews that request so a key/button cannot teleport from lock to lock.
 */
export function updateDigitalSteeringInput(
  currentInput: number,
  direction: -1 | 0 | 1,
  _speedMs: number,
  dt: number
): number {
  if (dt <= 0) return PhysicsMath.clamp(currentInput, -1, 1);

  const target = direction;

  // A driver can throw the wheel back through center faster than they normally
  // wind steering into a corner. This is input-device emulation only: it does not
  // inspect yaw, sideslip, tire state, or vehicle motion and never adds forces.
  const reversingDirection =
    direction !== 0 && Math.sign(currentInput) !== 0 && Math.sign(target) !== Math.sign(currentInput);
  const ratePerSecond = direction === 0 ? 7.0 : reversingDirection ? 7.0 : 4.8;
  const maxStep = ratePerSecond * dt;
  const error = target - currentInput;

  if (Math.abs(error) <= maxStep) return target;
  return PhysicsMath.clamp(currentInput + Math.sign(error) * maxStep, -1, 1);
}

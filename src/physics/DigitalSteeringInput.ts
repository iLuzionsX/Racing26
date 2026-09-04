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
  speedMs: number,
  dt: number
): number {
  if (dt <= 0) return PhysicsMath.clamp(currentInput, -1, 1);

  const target = direction;

  // Input-device emulation only: handwheel rate slows with road speed because a
  // human cannot and should not throw full lock at 150 km/h as fast as at park.
  // Eventual authority is preserved (held key still reaches +/-1) and reversal
  // through center stays fast so opposite-lock catch remains reachable. This
  // never inspects yaw/sideslip/tire state and never adds forces or yaw damping.
  const speed = Math.abs(Number.isFinite(speedMs) ? speedMs : 0);
  // Full rate to 25 m/s (~90 km/h, oversteer-catch region), then linear fade to
  // 45% rate at 55 m/s (~198 km/h). Uses existing PhysicsMath clamp only.
  const speedT = PhysicsMath.clamp((speed - 25) / 30, 0, 1);
  const cruiseRate = 4.8 * (1 - 0.55 * speedT);
  const reversingDirection =
    direction !== 0 && Math.sign(currentInput) !== 0 && Math.sign(target) !== Math.sign(currentInput);
  const ratePerSecond = direction === 0 ? 7.0 : reversingDirection ? 7.0 : cruiseRate;
  const maxStep = ratePerSecond * dt;
  const error = target - currentInput;

  if (Math.abs(error) <= maxStep) return target;
  return PhysicsMath.clamp(currentInput + Math.sign(error) * maxStep, -1, 1);
}

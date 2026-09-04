import { PhysicsMath } from './math/PhysicsMath';

/**
 * Keyboard/touch inputs are binary, so they still need a steering-rate adapter.
 * They must NOT lose steering authority, though: the physical rack in DriverAids
 * already applies its own road-speed steering geometry/rate. A second amplitude
 * cap here used to make high-speed countersteer physically unreachable.
 *
 * Full left/right therefore always means a full driver request (+/-1) eventually.
 * This helper only slews that request so a key/button cannot teleport from lock
 * to lock at a rate no human hand-wheel could produce at speed.
 */
export function digitalSteerWindRatePerSecond(speedMs: number): number {
  const speed = Number.isFinite(speedMs) ? Math.abs(speedMs) : 0;
  const clamped = PhysicsMath.clamp(speed, 0, 55);
  // Human hand-wheel rate mapped to normalized input. Parking/low-speed keeps
  // the legacy 4.8/s wind-in; by 50 m/s (~180 km/h) wind-in slows to 1.4/s.
  // Symmetric in sign, amplitude-preserving: a held key still reaches +/-1,
  // it just cannot step there in ~0.2 s at highway speed. Reversal/release
  // rates are handled separately and stay fast for oversteer recovery.
  return Math.max(1.4, 4.8 - clamped * 0.068);
}

export function updateDigitalSteeringInput(
  currentInput: number,
  direction: -1 | 0 | 1,
  speedMs: number,
  dt: number
): number {
  if (dt <= 0) return PhysicsMath.clamp(currentInput, -1, 1);

  const target = direction;

  // A driver can throw the wheel back through center faster than they normally
  // wind steering into a corner. This is input-device emulation only: it does not
  // inspect yaw, sideslip, tire state, or vehicle motion and never adds forces.
  const reversingDirection =
    direction !== 0 && Math.sign(currentInput) !== 0 && Math.sign(target) !== Math.sign(currentInput);
  const windRate = digitalSteerWindRatePerSecond(speedMs);
  const ratePerSecond = direction === 0 ? 7.0 : reversingDirection ? 7.0 : windRate;
  const maxStep = ratePerSecond * dt;
  const error = target - currentInput;

  if (Math.abs(error) <= maxStep) return target;
  return PhysicsMath.clamp(currentInput + Math.sign(error) * maxStep, -1, 1);
}

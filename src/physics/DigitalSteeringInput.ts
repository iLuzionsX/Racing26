import { PhysicsMath } from './math/PhysicsMath';

export interface DigitalSteeringContext {
  /** Physical wheelbase used by the bicycle-model steering envelope. */
  wheelbaseM?: number;
  /** Mechanical center road-wheel lock. Analog inputs retain this full range. */
  maxSteerAngleRad?: number;
  /** Body yaw rate; + is a left/yaw-left rotation per PHYSICS_CONVENTIONS.md. */
  yawRateRadS?: number;
  /**
   * Body sideslip angle from local velocity, atan2(localVx, |localVz|).
   * +X is vehicle-left. During a left oversteer slide this is typically negative.
   */
  sideslipRad?: number;
  /** Signed local forward speed. Recovery authority is disabled while reversing. */
  forwardSpeedMs?: number;
  /** Normal full-key cornering target. Kept below the M5's measured skidpad peak. */
  targetLateralAccelerationG?: number;
}

const GRAVITY_MS2 = 9.81;
const DEFAULT_WHEELBASE_M = 3.0;
const DEFAULT_MAX_STEER_RAD = 0.58;
const DEFAULT_TARGET_LATERAL_G = 0.88;
const RECOVERY_MIN_FORWARD_SPEED_MS = 8.0;
const RECOVERY_SLIP_START_RAD = 4.0 * Math.PI / 180;
const RECOVERY_SLIP_FULL_RAD = 14.0 * Math.PI / 180;
const RECOVERY_YAW_START_RAD_S = 0.25;
const RECOVERY_YAW_FULL_RAD_S = 0.85;

function finiteOr(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) ? Number(value) : fallback;
}

function smoothstep01(value: number): number {
  const t = PhysicsMath.clamp(value, 0, 1);
  return t * t * (3 - 2 * t);
}

/**
 * Maximum ordinary digital-driver request at a given road speed.
 *
 * A keyboard button has no steering travel, so mapping "held" directly to the
 * physical rack's +/-33 deg center angle is not analogous to a human driver.
 * Instead, a full normal key hold asks for a physically useful lateral
 * acceleration. A bicycle-model relationship converts that target to road-wheel
 * angle:
 *
 *   delta = atan(L * a_lat / v^2)
 *
 * The mechanical rack is untouched. At parking/crawl speed the limit naturally
 * returns to full authority; at road speed it falls to the few degrees of
 * road-wheel angle that the tires can actually use before saturation.
 */
export function digitalSteeringLimitForSpeed(
  speedMs: number,
  context: DigitalSteeringContext = {}
): number {
  const speed = Math.abs(finiteOr(speedMs, 0));
  const wheelbaseM = Math.max(0.5, finiteOr(context.wheelbaseM, DEFAULT_WHEELBASE_M));
  const maxSteerAngleRad = Math.max(
    1 * Math.PI / 180,
    Math.abs(finiteOr(context.maxSteerAngleRad, DEFAULT_MAX_STEER_RAD))
  );
  const targetLateralAccelerationG = PhysicsMath.clamp(
    finiteOr(context.targetLateralAccelerationG, DEFAULT_TARGET_LATERAL_G),
    0.25,
    1.25
  );

  // Below roughly jogging/urban speed the bicycle-model target already approaches
  // rack lock. Blend from full parking authority to the physical road-speed target
  // so the keyboard does not acquire a discontinuity around that crossover.
  const targetLatAccelMs2 = targetLateralAccelerationG * GRAVITY_MS2;
  const vSquared = Math.max(1.0, speed * speed);
  const usefulCenterAngle = Math.atan((wheelbaseM * targetLatAccelMs2) / vSquared);
  const physicsLimit = PhysicsMath.clamp(usefulCenterAngle / maxSteerAngleRad, 0, 1);

  // Parking assistance is finished by ~29 km/h. Above that, use the pure
  // bicycle-model envelope so speed scrub cannot automatically unlock extra
  // steering and create a tighten-scrub-tighten feedback loop.
  const roadSpeedBlend = smoothstep01((speed - 4.0) / 4.0);
  return PhysicsMath.lerp(1.0, physicsLimit, roadSpeedBlend);
}

/**
 * Returns 0 for ordinary steering and 0..1 only for a genuine opposite-lock
 * recovery condition. Requiring both yaw and sideslip sign/magnitude keeps a
 * normal left-right chicane from being misclassified as an oversteer catch.
 */
export function digitalCountersteerRecoveryBlend(
  direction: -1 | 0 | 1,
  speedMs: number,
  context: DigitalSteeringContext = {}
): number {
  if (direction === 0) return 0;

  const speed = Math.abs(finiteOr(speedMs, 0));
  const forwardSpeed = finiteOr(context.forwardSpeedMs, speed);
  if (speed < RECOVERY_MIN_FORWARD_SPEED_MS || forwardSpeed <= 0) return 0;

  const yawRate = finiteOr(context.yawRateRadS, 0);
  const sideslip = finiteOr(context.sideslipRad, 0);

  // Countersteer must oppose the current yaw rotation.
  if (direction * yawRate >= 0) return 0;

  // With +X vehicle-left, oversteer sideslip carries the same sign as the
  // corrective steering request (left-oversteer -> beta<0 -> steer right).
  if (direction * sideslip <= 0) return 0;

  const slipSeverity = smoothstep01(
    (Math.abs(sideslip) - RECOVERY_SLIP_START_RAD) /
      (RECOVERY_SLIP_FULL_RAD - RECOVERY_SLIP_START_RAD)
  );
  const yawSeverity = smoothstep01(
    (Math.abs(yawRate) - RECOVERY_YAW_START_RAD_S) /
      (RECOVERY_YAW_FULL_RAD_S - RECOVERY_YAW_START_RAD_S)
  );

  if (slipSeverity <= 0 || yawSeverity <= 0) return 0;
  return Math.sqrt(slipSeverity * yawSeverity);
}

export function digitalSteeringTarget(
  direction: -1 | 0 | 1,
  speedMs: number,
  context: DigitalSteeringContext = {}
): number {
  if (direction === 0) return 0;

  const normalLimit = digitalSteeringLimitForSpeed(speedMs, context);
  const recoveryBlend = digitalCountersteerRecoveryBlend(direction, speedMs, context);

  if (recoveryBlend <= 0) return direction * normalLimit;

  // Recovery authority must be continuous at the detection boundary. A tiny
  // non-zero yaw/slip confidence is common during a normal chicane reversal; it
  // must not jump the binary driver from a few percent of rack to a hard 45%.
  // Severe slides still recover the full mechanical rack as blend -> 1.
  const recoveryAuthority = PhysicsMath.lerp(normalLimit, 1.0, recoveryBlend);
  return direction * recoveryAuthority;
}

/**
 * Second-generation binary steering adapter.
 *
 * Normal corner entry is amplitude-shaped by road speed so a held A/D or touch
 * button cannot silently request parking-lot lock at 70-120 km/h. Release and
 * genuine oversteer countersteer remain fast. Analog mouse/wheel input bypasses
 * this helper and continues to address the physical rack directly.
 */
export function updateDigitalSteeringInput(
  currentInput: number,
  direction: -1 | 0 | 1,
  speedMs: number,
  dt: number,
  context: DigitalSteeringContext = {}
): number {
  const current = PhysicsMath.clamp(finiteOr(currentInput, 0), -1, 1);
  if (dt <= 0) return current;

  const target = digitalSteeringTarget(direction, speedMs, context);
  const recoveryBlend = digitalCountersteerRecoveryBlend(direction, speedMs, context);
  const reversingDirection =
    direction !== 0 &&
    Math.sign(current) !== 0 &&
    Math.sign(target) !== Math.sign(current);

  // Ordinary wind-on is deliberately human-like rather than instantaneous.
  // Release/reversal are quicker, and an identified slide gets the fastest path.
  const speed = Math.abs(finiteOr(speedMs, 0));
  const normalWindOnRate = PhysicsMath.lerp(
    4.8,
    2.4,
    PhysicsMath.clamp((speed - 5) / 30, 0, 1)
  );
  const baseRate =
    direction === 0
      ? 7.0
      : reversingDirection
        ? 7.0
        : normalWindOnRate;

  // Match the target continuity: a threshold crossing must not also create a
  // step in steering slew. Full recovery still reaches the fastest 8.5/s path.
  const ratePerSecond = PhysicsMath.lerp(
    baseRate,
    8.5,
    PhysicsMath.clamp(recoveryBlend, 0, 1)
  );

  const maxStep = ratePerSecond * dt;
  const error = target - current;

  if (Math.abs(error) <= maxStep) return target;
  return PhysicsMath.clamp(current + Math.sign(error) * maxStep, -1, 1);
}

/**
 * Rate-limit a true analog hand-position target without changing its amplitude.
 * This prevents mouse/touch pointer motion from teleporting directly into the
 * rack while preserving full mechanical travel and rapid unwind/countersteer.
 *
 * Unlike binary steering, analog input already carries meaningful hand position,
 * so it does not use the digital curvature envelope.
 */
export function slewAnalogSteeringInput(
  currentInput: number,
  targetInput: number,
  dt: number
): number {
  const current = PhysicsMath.clamp(finiteOr(currentInput, 0), -1, 1);
  const target = PhysicsMath.clamp(finiteOr(targetInput, 0), -1, 1);
  if (dt <= 0) return current;

  const error = target - current;
  if (Math.abs(error) <= 1e-12) return target;

  const reversingDirection =
    target !== 0 &&
    Math.sign(current) !== 0 &&
    Math.sign(target) !== Math.sign(current);
  const towardCenter = target === 0 || Math.abs(target) < Math.abs(current);
  const ratePerSecond = towardCenter || reversingDirection ? 7.0 : 4.8;
  const maxStep = ratePerSecond * dt;

  if (Math.abs(error) <= maxStep) return target;
  return PhysicsMath.clamp(current + Math.sign(error) * maxStep, -1, 1);
}

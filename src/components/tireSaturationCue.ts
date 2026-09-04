export interface FrontTireSaturationInput {
  gripUtilization: number;
  slipAngleRad: number;
  steerAngleRad: number;
}

export type FrontTireSaturationState = 'none' | 'approaching' | 'at-limit';

const DEG = 180 / Math.PI;

export const FRONT_SLIP_ONSET_DEG = 4.5;
export const FRONT_SLIP_FULL_DEG = 8.5;
export const FRONT_GRIP_ONSET = 0.75;
export const FRONT_GRIP_FULL = 0.98;
export const FRONT_STEER_GATE_ONSET_DEG = 1.0;
export const FRONT_STEER_GATE_FULL_DEG = 3.0;
export const FRONT_SATURATION_APPROACHING = 0.35;
export const FRONT_SATURATION_AT_LIMIT = 0.80;

const clamp01 = (value: number): number => {
  if (!Number.isFinite(value) || value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
};

const ramp01 = (value: number, start: number, end: number): number =>
  clamp01((value - start) / Math.max(1e-6, end - start));

/**
 * Presentational only. Uses telemetry that already exists on VehicleState.
 *
 * Slip angle always contributes because it directly describes the front
 * contact-patch state. Grip utilization is gated by actual front steer so
 * straight-line braking/acceleration cannot make the steering wheel look
 * corner-saturated.
 */
export function frontTireSaturationLevel(
  frontWheels: readonly FrontTireSaturationInput[]
): number {
  if (!frontWheels.length) return 0;

  let maxSlipDeg = 0;
  let maxGrip = 0;
  let maxSteerDeg = 0;

  for (const wheel of frontWheels) {
    const slipDeg = Number.isFinite(wheel.slipAngleRad)
      ? Math.abs(wheel.slipAngleRad) * DEG
      : 0;
    const grip = Number.isFinite(wheel.gripUtilization)
      ? Math.max(0, wheel.gripUtilization)
      : 0;
    const steerDeg = Number.isFinite(wheel.steerAngleRad)
      ? Math.abs(wheel.steerAngleRad) * DEG
      : 0;

    maxSlipDeg = Math.max(maxSlipDeg, slipDeg);
    maxGrip = Math.max(maxGrip, grip);
    maxSteerDeg = Math.max(maxSteerDeg, steerDeg);
  }

  const slipComponent = ramp01(
    maxSlipDeg,
    FRONT_SLIP_ONSET_DEG,
    FRONT_SLIP_FULL_DEG
  );
  const gripComponent =
    ramp01(maxGrip, FRONT_GRIP_ONSET, FRONT_GRIP_FULL) *
    ramp01(maxSteerDeg, FRONT_STEER_GATE_ONSET_DEG, FRONT_STEER_GATE_FULL_DEG);

  return Math.max(slipComponent, gripComponent);
}

export function frontTireSaturationState(
  level: number
): FrontTireSaturationState {
  if (!Number.isFinite(level) || level < FRONT_SATURATION_APPROACHING) return 'none';
  if (level < FRONT_SATURATION_AT_LIMIT) return 'approaching';
  return 'at-limit';
}

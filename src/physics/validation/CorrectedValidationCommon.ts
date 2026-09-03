import { Simulation } from '../Simulation';
import { PhysicsMath } from '../math/PhysicsMath';
import { DEFAULT_VEHICLE_CONFIG } from '../vehiclePresets';
import { BMW_M5_2025_OVERRIDES } from '../m5G90';
import { ValidationSurfaceProvider } from './ValidationSurfaceProvider';
import { findM5Reference } from './M5ReferenceData';
import { ensureArtifactDir, writeRowsCsv } from './ValidationArtifacts';

export const G = 9.81;
export const DT = 1 / 120;
export const RAD_TO_DEG = 180 / Math.PI;
export const DEG_TO_RAD = Math.PI / 180;
export const MPH_TO_KMH = 1.609344;
export const M_TO_FT = 3.280839895;

export const CONFIG = { ...DEFAULT_VEHICLE_CONFIG, ...BMW_M5_2025_OVERRIDES } as any;
export const NEUTRAL = {
  throttle: 0,
  brake: 0,
  steer: 0,
  handbrake: false,
  shiftUp: false,
  shiftDown: false,
};

export type Status = 'PASS' | 'WARNING' | 'FAIL' | 'NO REFERENCE DATA';

export type CorrectedValidationResult = {
  id: string;
  name: string;
  status: Status;
  validationClass: 'hard' | 'engineering-plausibility' | 'internal-regression';
  blocking: boolean;
  summary: string;
  metrics: Record<string, number | string | null>;
  diagnostics: string[];
  reference?: any;
  telemetryFile?: string;
  graphFiles?: string[];
};

export const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
export const mean = (v: number[]) => v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0;
export const maxAbs = (v: number[]) => v.length ? Math.max(...v.map(Math.abs)) : 0;
export const wrap = (v: number) => Math.atan2(Math.sin(v), Math.cos(v));

export function statusFor(metric: string, value: number) {
  const reference = findM5Reference(metric);
  if (!reference || !Number.isFinite(value)) {
    return { status: 'NO REFERENCE DATA' as Status, reference, errorPercent: undefined as number | undefined };
  }
  const min = reference.min ?? reference.target;
  const max = reference.max ?? reference.target;
  const target = reference.target ?? ((min ?? 0) + (max ?? 0)) * 0.5;
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    return { status: 'NO REFERENCE DATA' as Status, reference, errorPercent: undefined as number | undefined };
  }
  const errorPercent = target ? ((value - target) / target) * 100 : undefined;
  if (value >= min! && value <= max!) return { status: 'PASS' as Status, reference, errorPercent };
  const span = Math.max(Math.abs(max! - min!), Math.abs(target) * 0.01, 1e-6);
  if (value >= min! - span * 0.5 && value <= max! + span * 0.5) {
    return { status: 'WARNING' as Status, reference, errorPercent };
  }
  return { status: 'FAIL' as Status, reference, errorPercent };
}

export function combineStatuses(statuses: Status[]): Status {
  if (statuses.includes('FAIL')) return 'FAIL';
  if (statuses.includes('WARNING')) return 'WARNING';
  if (statuses.every((s) => s === 'NO REFERENCE DATA')) return 'NO REFERENCE DATA';
  if (statuses.includes('PASS')) return 'PASS';
  return 'NO REFERENCE DATA';
}

export function makeSim(surface = new ValidationSurfaceProvider({ friction: 1.0 })) {
  const sim = new Simulation(CONFIG, surface);
  sim.reset(0, 0, 0);
  for (let i = 0; i < Math.round(2.2 / DT); i++) sim.stepExplicit(NEUTRAL as any, 1);
  return sim;
}

export function setSpeed(sim: Simulation, speedMs: number) {
  sim.vehicle.rigidBody.velocity = PhysicsMath.quatRotateVec3(
    sim.vehicle.rigidBody.orientation,
    PhysicsMath.vec3(0, 0, speedMs)
  );
  sim.vehicle.wheels.forEach((wheel) => wheel.reset(speedMs));
}

export function autoShift(sim: Simulation) {
  const state = sim.vehicle.getState() as any;
  if (state.rpm > CONFIG.revLimiterRpm * 0.94 && state.gear > 0 && state.gear < 8) {
    sim.vehicle.powertrain.shiftUp();
  }
}

export function basicRow(sim: Simulation, t: number, controls: any): Record<string, unknown> {
  const state = sim.vehicle.getState() as any;
  const rb = sim.vehicle.rigidBody;
  const local = rb.getLocalVelocity();
  const row: Record<string, unknown> = {
    time_s: t,
    x_m: state.x,
    y_m: state.y,
    z_m: state.z,
    chassis_heave_m: state.heave,
    vx_body_ms: local.x,
    vy_body_ms: local.y,
    vz_body_ms: local.z,
    speed_kmh: state.speedKmh,
    raw_ax_body_ms2: rb.acceleration.x,
    raw_ay_body_ms2: rb.acceleration.y,
    raw_az_body_ms2: rb.acceleration.z,
    chassis_vertical_accel_ms2: rb.acceleration.y,
    lateral_g: state.lateralG,
    longitudinal_g: state.longitudinalG,
    vertical_g: state.verticalG,
    yaw_deg: state.yaw * RAD_TO_DEG,
    pitch_deg: state.pitch * RAD_TO_DEG,
    roll_deg: state.roll * RAD_TO_DEG,
    yaw_rate_deg_s: state.yawRate * RAD_TO_DEG,
    pitch_rate_deg_s: state.pitchRate * RAD_TO_DEG,
    roll_rate_deg_s: state.rollRate * RAD_TO_DEG,
    yaw_accel_deg_s2: rb.angularAcceleration.y * RAD_TO_DEG,
    pitch_accel_deg_s2: rb.angularAcceleration.x * RAD_TO_DEG,
    roll_accel_deg_s2: rb.angularAcceleration.z * RAD_TO_DEG,
    sideslip_deg: Math.atan2(local.x, Math.max(0.1, Math.abs(local.z))) * RAD_TO_DEG,
    throttle: controls.throttle,
    brake: controls.brake,
    steer_command: controls.steer,
    gear: state.gear,
    rpm: state.rpm,
    abs_active: state.absActive,
    tcs_active: state.tcsActive,
  };

  state.wheels.forEach((wheel: any, i: number) => {
    const prefix = ['fl', 'fr', 'rl', 'rr'][i];
    const susp = sim.vehicle.suspension.states[i] as any;
    row[`${prefix}_road_contact_y_m`] = susp.contactPointWorld.y;
    row[`${prefix}_tire_center_world_y_m`] = susp.hubPositionWorldY;
    row[`${prefix}_fz_n`] = wheel.forceVectorNorm;
    row[`${prefix}_tire_normal_force_n`] = susp.tireNormalForceN;
    row[`${prefix}_chassis_force_n`] = susp.chassisForceN;
    row[`${prefix}_applied_chassis_force_n`] = susp.appliedChassisForceN ?? susp.chassisForceN;
    row[`${prefix}_evaluated_chassis_force_n`] = susp.evaluatedChassisForceN ?? susp.chassisForceN;
    row[`${prefix}_fx_n`] = wheel.forceVectorLong;
    row[`${prefix}_fy_n`] = wheel.forceVectorLat;
    row[`${prefix}_slip_angle_deg`] = wheel.slipAngle * RAD_TO_DEG;
    row[`${prefix}_slip_ratio`] = wheel.slipRatio;
    row[`${prefix}_omega_rad_s`] = wheel.angularVelocity;
    row[`${prefix}_steer_deg`] = wheel.steerAngle * RAD_TO_DEG;
    row[`${prefix}_suspension_displacement_m`] = susp.displacement;
    row[`${prefix}_suspension_compression_ratio`] = susp.compressionRatio;
    row[`${prefix}_suspension_velocity_ms`] = susp.velocity;
    row[`${prefix}_hub_world_y_m`] = susp.hubPositionWorldY;
    row[`${prefix}_hub_velocity_ms`] = susp.hubVelocityWorldY;
    row[`${prefix}_unsprung_accel_ms2`] = susp.unsprungAccelerationMps2;
    row[`${prefix}_unsprung_mass_kg`] = susp.unsprungMassKg;
    row[`${prefix}_spring_force_n`] = susp.springForceN;
    row[`${prefix}_damper_force_n`] = susp.damperForceN;
    row[`${prefix}_bumpstop_force_n`] = susp.bumpStopForceN;
    row[`${prefix}_bumpstop_engaged`] = susp.bumpStopEngaged;
    row[`${prefix}_hardstop_force_n`] = susp.hardStopForceN;
    row[`${prefix}_arb_force_n`] = susp.antiRollBarForceN;
    row[`${prefix}_camber_deg`] = wheel.camberAngleDeg;
    row[`${prefix}_aligning_moment_nm`] = wheel.aligningTorque;
    row[`${prefix}_pneumatic_trail_m`] = wheel.pneumaticTrail;
    row[`${prefix}_grip_utilization`] = wheel.gripUtilization;
    row[`${prefix}_temperature_c`] = wheel.temperature;
    row[`${prefix}_pressure_psi`] = wheel.pressurePsi;
    row[`${prefix}_wear_percent`] = wheel.tireWearPercent;
    row[`${prefix}_contact`] = !wheel.isAirborne;
  });
  return row;
}

export function writeTelemetry(artifactDir: string, id: string, rows: Record<string, unknown>[]) {
  ensureArtifactDir(`${artifactDir}/telemetry`);
  const path = `${artifactDir}/telemetry/${id}.csv`;
  writeRowsCsv(path, rows);
  return path;
}

export function accelerateTo(sim: Simulation, targetKmh: number, timeoutSec = 16): number {
  const maxSteps = Math.round(timeoutSec / DT);
  for (let i = 0; i < maxSteps; i++) {
    sim.stepExplicit({ ...NEUTRAL, throttle: 1 } as any, 1);
    autoShift(sim);
    const speed = (sim.vehicle.getState() as any).speedKmh;
    if (speed >= targetKmh) return speed;
  }
  return (sim.vehicle.getState() as any).speedKmh;
}

export function linearSlope(points: { x: number; y: number }[]) {
  if (points.length < 2) return Number.NaN;
  const mx = mean(points.map((p) => p.x));
  const my = mean(points.map((p) => p.y));
  const denominator = points.reduce((sum, p) => sum + (p.x - mx) ** 2, 0);
  if (denominator < 1e-12) return Number.NaN;
  return points.reduce((sum, p) => sum + (p.x - mx) * (p.y - my), 0) / denominator;
}

export function dominantFrequency(values: number[], minHz: number, maxHz: number) {
  if (values.length < 60) return null;
  const centered = values.map((value) => value - mean(values));
  let bestHz = minHz;
  let bestPower = -1;
  for (let hz = minHz; hz <= maxHz + 1e-9; hz += 0.25) {
    let re = 0;
    let im = 0;
    for (let i = 0; i < centered.length; i++) {
      const phase = 2 * Math.PI * hz * i * DT;
      re += centered[i] * Math.cos(phase);
      im -= centered[i] * Math.sin(phase);
    }
    const power = re * re + im * im;
    if (power > bestPower) {
      bestPower = power;
      bestHz = hz;
    }
  }
  return bestPower > 1e-16 ? bestHz : null;
}

export function totalKineticEnergy(sim: Simulation) {
  const rb = sim.vehicle.rigidBody;
  const I = rb.config.inertia;
  const omega = rb.getLocalAngularVelocity();
  const translational = 0.5 * rb.config.mass * PhysicsMath.vec3Dot(rb.velocity, rb.velocity);
  const rotational = 0.5 * (I.x * omega.x ** 2 + I.y * omega.y ** 2 + I.z * omega.z ** 2);
  const wheelRotational = sim.vehicle.wheels.reduce(
    (sum, wheel: any) => sum + 0.5 * CONFIG.wheelInertia * wheel.angularVelocity ** 2,
    0
  );
  return translational + rotational + wheelRotational;
}
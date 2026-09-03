import { existsSync, readFileSync } from 'node:fs';
import { Simulation } from '../Simulation';
import { RigidBody } from '../RigidBody';
import { deriveChassisMassProperties } from '../ChassisMassProperties';
import { PhysicsMath } from '../math/PhysicsMath';
import { DEFAULT_VEHICLE_CONFIG } from '../vehiclePresets';
import { BMW_M5_2025_OVERRIDES } from '../m5G90';
import { ValidationSurfaceProvider, type ValidationSurfaceOptions } from './ValidationSurfaceProvider';
import {
  M5_REFERENCE_DATA,
  M5_REFERENCE_DATA_NEEDED,
  findM5Reference,
} from './M5ReferenceData';
import {
  ensureArtifactDir,
  writeJson,
  writeRowsCsv,
  writeLineChartSvg,
  writeMarkdown,
} from './ValidationArtifacts';

const G = 9.81;
const DT = 1 / 120;
const RAD_TO_DEG = 180 / Math.PI;
const DEG_TO_RAD = Math.PI / 180;
const MPH_TO_KMH = 1.609344;
const M_TO_FT = 3.280839895;
const WHEEL_IDS = ['FL', 'FR', 'RL', 'RR'] as const;

const BASE_CONFIG = {
  ...DEFAULT_VEHICLE_CONFIG,
  ...BMW_M5_2025_OVERRIDES,
} as any;

const NEUTRAL = {
  throttle: 0,
  brake: 0,
  steer: 0,
  handbrake: false,
  shiftUp: false,
  shiftDown: false,
};

type ValidationStatus = 'PASS' | 'WARNING' | 'FAIL' | 'NO REFERENCE DATA';
type ValidationClass = 'hard' | 'engineering-plausibility' | 'internal-regression';

type TireStateOptions = {
  temperatureC?: number;
  pressurePsi?: number;
  wearPercent?: number;
};

type HarnessOptions = {
  startSpeedKmh?: number;
  surface?: ValidationSurfaceOptions;
  tireState?: TireStateOptions;
  assists?: {
    absMode?: string;
    tcsMode?: string;
  };
};

type WheelTelemetry = {
  id: string;
  fzN: number;
  fxN: number;
  fyN: number;
  slipAngleRad: number;
  slipRatio: number;
  angularVelocityRadS: number;
  wheelSpeedMs: number;
  suspensionCompression: number;
  suspensionDisplacementM: number;
  suspensionVelocityMs: number;
  springForceN: number;
  damperForceN: number;
  bumpStopForceN: number;
  antiRollBarForceN: number;
  camberDeg: number;
  toeDeg: number | null;
  steerAngleRad: number;
  inContact: boolean;
  aligningMomentNm: number;
  pneumaticTrailM: number;
  temperatureC: number;
  pressurePsi: number;
  wearPercent: number;
  frictionCoefficient: number;
  gripUtilization: number;
};

type ValidationSample = {
  t: number;
  position: { x: number; y: number; z: number };
  velocityWorld: { x: number; y: number; z: number };
  velocityBody: { x: number; y: number; z: number };
  speedMs: number;
  speedKmh: number;
  accelBodyMs2: { x: number; y: number; z: number };
  lateralG: number;
  longitudinalG: number;
  verticalG: number;
  yawRad: number;
  pitchRad: number;
  rollRad: number;
  yawRateRadS: number;
  pitchRateRadS: number;
  rollRateRadS: number;
  yawAccelRadS2: number;
  pitchAccelRadS2: number;
  rollAccelRadS2: number;
  sideslipRad: number;
  controls: any;
  steeringWheelAngleRad: number | null;
  steeringWheelAngleSource: 'simulated' | 'derived-overall-ratio' | 'unavailable';
  steeringWheelAngularVelocityRadS: number | null;
  rackPositionM: number | null;
  roadWheelAnglesRad: [number, number, number, number];
  gear: number;
  rpm: number;
  absActive: boolean;
  tcsActive: boolean;
  reconstructedMomentNm: { pitch: number; yaw: number; roll: number };
  predictedAngularAccelRadS2: { pitch: number; yaw: number; roll: number };
  wheels: [WheelTelemetry, WheelTelemetry, WheelTelemetry, WheelTelemetry];
};

type ValidationResult = {
  id: string;
  name: string;
  status: ValidationStatus;
  validationClass: ValidationClass;
  blocking: boolean;
  summary: string;
  metrics: Record<string, number | string | null>;
  diagnostics: string[];
  reference?: any;
  telemetry?: ValidationSample[];
  telemetryFile?: string;
  graphFiles?: string[];
};

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const mean = (values: number[]) => values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
const maxAbs = (values: number[]) => values.length ? Math.max(...values.map(Math.abs)) : 0;
const last = <T>(values: T[]) => values[values.length - 1];
const wrapAngle = (rad: number) => Math.atan2(Math.sin(rad), Math.cos(rad));

function percentile(values: number[], p: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = clamp(p, 0, 1) * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

function linearSlope(points: { x: number; y: number }[]): number {
  const finitePoints = points.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
  if (finitePoints.length < 2) return Number.NaN;
  const mx = mean(finitePoints.map((p) => p.x));
  const my = mean(finitePoints.map((p) => p.y));
  const denom = finitePoints.reduce((sum, p) => sum + (p.x - mx) ** 2, 0);
  if (denom < 1e-12) return Number.NaN;
  return finitePoints.reduce((sum, p) => sum + (p.x - mx) * (p.y - my), 0) / denom;
}

function thresholdCrossing(
  samples: ValidationSample[],
  getter: (s: ValidationSample) => number,
  threshold: number,
  startIndex = 0
): number | null {
  for (let i = Math.max(1, startIndex); i < samples.length; i++) {
    const a = getter(samples[i - 1]);
    const b = getter(samples[i]);
    if ((a < threshold && b >= threshold) || (a > threshold && b <= threshold)) {
      const span = b - a;
      const f = Math.abs(span) < 1e-12 ? 1 : (threshold - a) / span;
      return samples[i - 1].t + (samples[i].t - samples[i - 1].t) * clamp(f, 0, 1);
    }
  }
  return null;
}

function dominantFrequency(values: number[], sampleRateHz = 120, minHz = 0.5, maxHz = 25): number | null {
  if (values.length < 60) return null;
  const avg = mean(values);
  const centered = values.map((v) => v - avg);
  let bestHz = minHz;
  let bestPower = -Infinity;
  const stepHz = 0.25;
  for (let hz = minHz; hz <= maxHz + 1e-9; hz += stepHz) {
    let re = 0;
    let im = 0;
    for (let n = 0; n < centered.length; n++) {
      const phase = 2 * Math.PI * hz * n / sampleRateHz;
      re += centered[n] * Math.cos(phase);
      im -= centered[n] * Math.sin(phase);
    }
    const power = re * re + im * im;
    if (power > bestPower) {
      bestPower = power;
      bestHz = hz;
    }
  }
  return bestPower > 1e-16 ? bestHz : null;
}

function referenceStatus(metric: string, value: number): { status: ValidationStatus; reference?: any; errorPercent?: number } {
  const reference = findM5Reference(metric);
  if (!reference || !Number.isFinite(value)) return { status: 'NO REFERENCE DATA' };
  const min = reference.min ?? reference.target;
  const max = reference.max ?? reference.target;
  if (!Number.isFinite(min) || !Number.isFinite(max)) return { status: 'NO REFERENCE DATA', reference };
  const target = reference.target ?? (min + max) * 0.5;
  const errorPercent = target ? ((value - target) / target) * 100 : undefined;
  if (value >= min && value <= max) return { status: 'PASS', reference, errorPercent };
  const span = Math.max(Math.abs(max - min), Math.abs(target) * 0.01, 1e-6);
  const warningMin = min - 0.5 * span;
  const warningMax = max + 0.5 * span;
  if (value >= warningMin && value <= warningMax) return { status: 'WARNING', reference, errorPercent };
  return { status: 'FAIL', reference, errorPercent };
}

function combineStatuses(statuses: ValidationStatus[]): ValidationStatus {
  if (statuses.includes('FAIL')) return 'FAIL';
  if (statuses.includes('WARNING')) return 'WARNING';
  if (statuses.every((s) => s === 'NO REFERENCE DATA')) return 'NO REFERENCE DATA';
  if (statuses.includes('PASS')) return 'PASS';
  return 'NO REFERENCE DATA';
}

class DeterministicHarness {
  public sim: Simulation;
  public config: any;
  public samples: ValidationSample[] = [];
  public anomalies: string[] = [];
  public readonly surface: ValidationSurfaceProvider;
  private previousSteeringWheelAngleRad: number | null = null;

  constructor(public options: HarnessOptions = {}) {
    this.config = { ...BASE_CONFIG };
    if (options.assists?.absMode) this.config.absMode = options.assists.absMode;
    if (options.assists?.tcsMode) this.config.tcsMode = options.assists.tcsMode;
    this.surface = new ValidationSurfaceProvider(options.surface);
    this.sim = new Simulation(this.config, this.surface);
    this.reset(0, 0, 0, options.startSpeedKmh ?? 0);
  }

  public reset(x = 0, z = 0, yaw = 0, startSpeedKmh = 0) {
    this.sim.reset(x, z, yaw);
    this.samples = [];
    this.anomalies = [];
    this.previousSteeringWheelAngleRad = null;
    this.applyTireState();
    this.settle(2.2);
    if (startSpeedKmh > 0) this.setSpeed(startSpeedKmh / 3.6);
  }

  private applyTireState() {
    const state = this.options.tireState;
    if (!state) return;
    for (const wheel of this.sim.vehicle.wheels as any[]) {
      if (Number.isFinite(state.temperatureC)) wheel.temperature = state.temperatureC;
      if (Number.isFinite(state.pressurePsi)) wheel.pressurePsi = state.pressurePsi;
      if (Number.isFinite(state.wearPercent)) wheel.wearPercent = state.wearPercent;
    }
  }

  public settle(seconds: number) {
    const steps = Math.max(0, Math.round(seconds / DT));
    for (let i = 0; i < steps; i++) this.sim.stepExplicit(NEUTRAL as any, 1);
  }

  public setSpeed(speedMs: number) {
    const forwardWorld = PhysicsMath.quatRotateVec3(
      this.sim.vehicle.rigidBody.orientation,
      PhysicsMath.vec3(0, 0, speedMs)
    );
    this.sim.vehicle.rigidBody.velocity = forwardWorld;
    this.sim.vehicle.wheels.forEach((wheel) => wheel.reset(speedMs));
  }

  public step(inputs: any): ValidationSample {
    this.sim.stepExplicit(inputs, 1);
    const sample = this.capture(inputs);
    this.samples.push(sample);
    this.scanSample(sample);
    return sample;
  }

  public run(seconds: number, driver: (t: number, harness: DeterministicHarness) => any) {
    const steps = Math.round(seconds / DT);
    for (let i = 0; i < steps; i++) {
      const t = i * DT;
      this.step(driver(t, this));
    }
    return this.samples;
  }

  private steeringTelemetry(state: any): {
    steeringWheelAngleRad: number | null;
    steeringWheelAngleSource: 'simulated' | 'derived-overall-ratio' | 'unavailable';
    rackPositionM: number | null;
  } {
    const vehicleAny = this.sim.vehicle as any;
    const aidsAny = vehicleAny.driverAids as any;
    const steering =
      vehicleAny.steeringSystem ??
      vehicleAny.physicalSteering ??
      aidsAny?.steeringSystem ??
      aidsAny?.physicalSteering ??
      aidsAny?.steeringRack ??
      null;

    const physicalAngle = steering?.steeringWheelAngle ?? steering?.state?.steeringWheelAngle ?? null;
    const rackPosition = steering?.rackPositionM ?? steering?.rackPosition ?? steering?.state?.rackPositionM ?? null;
    if (Number.isFinite(physicalAngle)) {
      return {
        steeringWheelAngleRad: physicalAngle,
        steeringWheelAngleSource: 'simulated',
        rackPositionM: Number.isFinite(rackPosition) ? rackPosition : null,
      };
    }

    const officialOverallRatio = M5_REFERENCE_DATA.bmw_steering_ratio.target;
    if (Number.isFinite(officialOverallRatio) && Number.isFinite(state.actualSteerAngle)) {
      return {
        steeringWheelAngleRad: state.actualSteerAngle * officialOverallRatio,
        steeringWheelAngleSource: 'derived-overall-ratio',
        rackPositionM: Number.isFinite(rackPosition) ? rackPosition : null,
      };
    }

    return { steeringWheelAngleRad: null, steeringWheelAngleSource: 'unavailable', rackPositionM: null };
  }

  private reconstructMoment(state: any): { pitch: number; yaw: number; roll: number } {
    const hardpoints = this.sim.vehicle.getHardpointsBody();
    let pitch = 0;
    let yaw = 0;
    let roll = 0;
    for (let i = 0; i < 4; i++) {
      const wheel = state.wheels[i];
      const steer = wheel.steerAngle;
      const cosS = Math.cos(steer);
      const sinS = Math.sin(steer);
      const fxBody = wheel.forceVectorLat * cosS + wheel.forceVectorLong * sinS;
      const fzBody = -wheel.forceVectorLat * sinS + wheel.forceVectorLong * cosS;
      const fyBody = wheel.forceVectorNorm;
      const r = {
        x: hardpoints[i].x,
        y: -this.config.centerOfGravityHeight,
        z: hardpoints[i].z,
      };
      const torque = PhysicsMath.vec3Cross(
        PhysicsMath.vec3(r.x, r.y, r.z),
        PhysicsMath.vec3(fxBody, fyBody, fzBody)
      );
      pitch += torque.x;
      yaw += torque.y + (wheel.aligningTorque ?? 0);
      roll += torque.z;
    }
    return { pitch, yaw, roll };
  }

  private predictedAngularAccel(moment: { pitch: number; yaw: number; roll: number }) {
    const rb = this.sim.vehicle.rigidBody;
    const omega = rb.getLocalAngularVelocity();
    const I = rb.config.inertia;
    const iOmega = PhysicsMath.vec3(I.x * omega.x, I.y * omega.y, I.z * omega.z);
    const gyro = PhysicsMath.vec3Cross(omega, iOmega);
    return {
      pitch: (moment.pitch - gyro.x) / I.x,
      yaw: (moment.yaw - gyro.y) / I.y,
      roll: (moment.roll - gyro.z) / I.z,
    };
  }

  private capture(inputs: any): ValidationSample {
    const vehicle = this.sim.vehicle;
    const rb = vehicle.rigidBody;
    const state = vehicle.getState() as any;
    const localVel = rb.getLocalVelocity();
    const steering = this.steeringTelemetry(state);
    const steeringWheelAngularVelocityRadS =
      steering.steeringWheelAngleRad !== null && this.previousSteeringWheelAngleRad !== null
        ? (steering.steeringWheelAngleRad - this.previousSteeringWheelAngleRad) / DT
        : null;
    this.previousSteeringWheelAngleRad = steering.steeringWheelAngleRad;
    const moment = this.reconstructMoment(state);
    const predicted = this.predictedAngularAccel(moment);

    const wheels = state.wheels.map((wheel: any, i: number) => {
      const susp = vehicle.suspension.states[i] as any;
      return {
        id: wheel.id,
        fzN: wheel.forceVectorNorm,
        fxN: wheel.forceVectorLong,
        fyN: wheel.forceVectorLat,
        slipAngleRad: wheel.slipAngle,
        slipRatio: wheel.slipRatio,
        angularVelocityRadS: wheel.angularVelocity,
        wheelSpeedMs: wheel.angularVelocity * this.config.wheelRadius,
        suspensionCompression: wheel.suspensionCompression,
        suspensionDisplacementM: susp.displacement,
        suspensionVelocityMs: susp.velocity,
        springForceN: susp.springForceN,
        damperForceN: susp.damperForceN,
        bumpStopForceN: susp.bumpStopForceN,
        antiRollBarForceN: susp.antiRollBarForceN,
        camberDeg: wheel.camberAngleDeg,
        toeDeg: Number.isFinite(susp.dynamicToeDeg) ? susp.dynamicToeDeg : null,
        steerAngleRad: wheel.steerAngle,
        inContact: !wheel.isAirborne,
        aligningMomentNm: wheel.aligningTorque ?? 0,
        pneumaticTrailM: wheel.pneumaticTrail ?? 0,
        temperatureC: wheel.temperature,
        pressurePsi: wheel.pressurePsi,
        wearPercent: wheel.tireWearPercent,
        frictionCoefficient: wheel.surfaceFriction,
        gripUtilization: wheel.gripUtilization,
      } as WheelTelemetry;
    }) as [WheelTelemetry, WheelTelemetry, WheelTelemetry, WheelTelemetry];

    return {
      t: this.samples.length * DT,
      position: { x: rb.position.x, y: rb.position.y, z: rb.position.z },
      velocityWorld: { x: rb.velocity.x, y: rb.velocity.y, z: rb.velocity.z },
      velocityBody: { x: localVel.x, y: localVel.y, z: localVel.z },
      speedMs: state.speedMs,
      speedKmh: state.speedKmh,
      accelBodyMs2: { x: rb.acceleration.x, y: rb.acceleration.y, z: rb.acceleration.z },
      lateralG: state.lateralG,
      longitudinalG: state.longitudinalG,
      verticalG: state.verticalG,
      yawRad: state.yaw,
      pitchRad: state.pitch,
      rollRad: state.roll,
      yawRateRadS: state.yawRate,
      pitchRateRadS: state.pitchRate,
      rollRateRadS: state.rollRate,
      yawAccelRadS2: rb.angularAcceleration.y,
      pitchAccelRadS2: rb.angularAcceleration.x,
      rollAccelRadS2: rb.angularAcceleration.z,
      sideslipRad: Math.atan2(localVel.x, Math.max(0.1, Math.abs(localVel.z))),
      controls: { ...inputs },
      steeringWheelAngleRad: steering.steeringWheelAngleRad,
      steeringWheelAngleSource: steering.steeringWheelAngleSource,
      steeringWheelAngularVelocityRadS,
      rackPositionM: steering.rackPositionM,
      roadWheelAnglesRad: [wheels[0].steerAngleRad, wheels[1].steerAngleRad, wheels[2].steerAngleRad, wheels[3].steerAngleRad],
      gear: state.gear,
      rpm: state.rpm,
      absActive: Boolean(state.absActive),
      tcsActive: Boolean(state.tcsActive),
      reconstructedMomentNm: moment,
      predictedAngularAccelRadS2: predicted,
      wheels,
    };
  }

  private scanSample(sample: ValidationSample) {
    const numeric = [
      sample.speedMs, sample.yawRad, sample.pitchRad, sample.rollRad,
      sample.yawRateRadS, sample.pitchRateRadS, sample.rollRateRadS,
      sample.yawAccelRadS2, sample.pitchAccelRadS2, sample.rollAccelRadS2,
      sample.accelBodyMs2.x, sample.accelBodyMs2.y, sample.accelBodyMs2.z,
      ...sample.wheels.flatMap((w) => [
        w.fzN, w.fxN, w.fyN, w.slipAngleRad, w.slipRatio,
        w.angularVelocityRadS, w.suspensionDisplacementM, w.suspensionVelocityMs,
        w.springForceN, w.damperForceN, w.bumpStopForceN, w.gripUtilization,
      ]),
    ];
    if (numeric.some((v) => !Number.isFinite(v))) this.addAnomaly('NaN/Infinity detected in physics telemetry');
    if (sample.speedMs > 140) this.addAnomaly(`unbounded speed detected: ${(sample.speedMs * 3.6).toFixed(1)} km/h`);
    if (Math.abs(sample.yawRateRadS) > 8) this.addAnomaly(`angular-velocity explosion: yaw ${(sample.yawRateRadS * RAD_TO_DEG).toFixed(1)} deg/s`);
    if (Math.abs(sample.rollRad) > 1.35 || Math.abs(sample.pitchRad) > 1.35) this.addAnomaly('chassis attitude exceeded physically coherent regression envelope');

    sample.wheels.forEach((wheel) => {
      if (wheel.fzN < -1) this.addAnomaly(`${wheel.id}: negative tire normal load ${wheel.fzN.toFixed(1)} N`);
      if (!wheel.inContact && Math.hypot(wheel.fxN, wheel.fyN) > 75) {
        this.addAnomaly(`${wheel.id}: tire shear force exists while contact is absent`);
      }
      if (wheel.gripUtilization > 1.6) this.addAnomaly(`${wheel.id}: impossible friction utilization ${wheel.gripUtilization.toFixed(2)}`);
      if (wheel.suspensionDisplacementM > 0.155 || wheel.suspensionDisplacementM < -0.135) {
        this.addAnomaly(`${wheel.id}: suspension travel exceeded configured mechanical envelope`);
      }
      if (Math.abs(wheel.suspensionVelocityMs) > 12) this.addAnomaly(`${wheel.id}: extreme suspension velocity ${wheel.suspensionVelocityMs.toFixed(2)} m/s`);
    });
  }

  private addAnomaly(message: string) {
    if (!this.anomalies.includes(message)) this.anomalies.push(message);
  }
}

function flattenSample(sample: ValidationSample): Record<string, unknown> {
  const row: Record<string, unknown> = {
    time_s: sample.t,
    x_m: sample.position.x,
    y_m: sample.position.y,
    z_m: sample.position.z,
    vx_world_ms: sample.velocityWorld.x,
    vy_world_ms: sample.velocityWorld.y,
    vz_world_ms: sample.velocityWorld.z,
    vx_body_ms: sample.velocityBody.x,
    vy_body_ms: sample.velocityBody.y,
    vz_body_ms: sample.velocityBody.z,
    speed_kmh: sample.speedKmh,
    ax_body_ms2: sample.accelBodyMs2.x,
    ay_body_ms2: sample.accelBodyMs2.y,
    az_body_ms2: sample.accelBodyMs2.z,
    lateral_g: sample.lateralG,
    longitudinal_g: sample.longitudinalG,
    vertical_g: sample.verticalG,
    yaw_deg: sample.yawRad * RAD_TO_DEG,
    pitch_deg: sample.pitchRad * RAD_TO_DEG,
    roll_deg: sample.rollRad * RAD_TO_DEG,
    yaw_rate_deg_s: sample.yawRateRadS * RAD_TO_DEG,
    pitch_rate_deg_s: sample.pitchRateRadS * RAD_TO_DEG,
    roll_rate_deg_s: sample.rollRateRadS * RAD_TO_DEG,
    yaw_accel_deg_s2: sample.yawAccelRadS2 * RAD_TO_DEG,
    pitch_accel_deg_s2: sample.pitchAccelRadS2 * RAD_TO_DEG,
    roll_accel_deg_s2: sample.rollAccelRadS2 * RAD_TO_DEG,
    sideslip_deg: sample.sideslipRad * RAD_TO_DEG,
    throttle: sample.controls.throttle,
    brake: sample.controls.brake,
    steer_command: sample.controls.steer,
    steering_wheel_deg: sample.steeringWheelAngleRad === null ? null : sample.steeringWheelAngleRad * RAD_TO_DEG,
    steering_wheel_source: sample.steeringWheelAngleSource,
    steering_wheel_rate_deg_s: sample.steeringWheelAngularVelocityRadS === null ? null : sample.steeringWheelAngularVelocityRadS * RAD_TO_DEG,
    rack_position_m: sample.rackPositionM,
    gear: sample.gear,
    rpm: sample.rpm,
    abs_active: sample.absActive,
    tcs_active: sample.tcsActive,
    mz_reconstructed_nm: sample.reconstructedMomentNm.yaw,
    yaw_accel_predicted_deg_s2: sample.predictedAngularAccelRadS2.yaw * RAD_TO_DEG,
  };
  sample.wheels.forEach((wheel) => {
    const p = wheel.id.toLowerCase();
    row[`${p}_fz_n`] = wheel.fzN;
    row[`${p}_fx_n`] = wheel.fxN;
    row[`${p}_fy_n`] = wheel.fyN;
    row[`${p}_slip_angle_deg`] = wheel.slipAngleRad * RAD_TO_DEG;
    row[`${p}_slip_ratio`] = wheel.slipRatio;
    row[`${p}_omega_rad_s`] = wheel.angularVelocityRadS;
    row[`${p}_wheel_speed_ms`] = wheel.wheelSpeedMs;
    row[`${p}_suspension_displacement_m`] = wheel.suspensionDisplacementM;
    row[`${p}_suspension_velocity_ms`] = wheel.suspensionVelocityMs;
    row[`${p}_spring_force_n`] = wheel.springForceN;
    row[`${p}_damper_force_n`] = wheel.damperForceN;
    row[`${p}_bump_stop_force_n`] = wheel.bumpStopForceN;
    row[`${p}_arb_force_n`] = wheel.antiRollBarForceN;
    row[`${p}_camber_deg`] = wheel.camberDeg;
    row[`${p}_toe_deg`] = wheel.toeDeg;
    row[`${p}_steer_deg`] = wheel.steerAngleRad * RAD_TO_DEG;
    row[`${p}_contact`] = wheel.inContact;
    row[`${p}_aligning_moment_nm`] = wheel.aligningMomentNm;
    row[`${p}_pneumatic_trail_m`] = wheel.pneumaticTrailM;
    row[`${p}_temperature_c`] = wheel.temperatureC;
    row[`${p}_pressure_psi`] = wheel.pressurePsi;
    row[`${p}_wear_percent`] = wheel.wearPercent;
    row[`${p}_friction`] = wheel.frictionCoefficient;
    row[`${p}_grip_utilization`] = wheel.gripUtilization;
  });
  return row;
}

function steerInputForRoadWheelDeg(deg: number, config = BASE_CONFIG): number {
  return clamp((deg * DEG_TO_RAD) / config.maxSteerAngle, -1, 1);
}

function autoShiftIfNeeded(h: DeterministicHarness) {
  const state = h.sim.vehicle.getState() as any;
  if (state.rpm > h.config.revLimiterRpm * 0.94 && state.gear > 0 && state.gear < 8) {
    h.sim.vehicle.powertrain.shiftUp();
  }
}

function saveTelemetry(id: string, samples: ValidationSample[], artifactDir: string): string {
  const file = `${artifactDir}/telemetry/${id}.csv`;
  ensureArtifactDir(`${artifactDir}/telemetry`);
  writeRowsCsv(file, samples.map(flattenSample));
  return file;
}

function testDeterminism(): ValidationResult {
  const run = () => {
    const h = new DeterministicHarness({ startSpeedKmh: 80 });
    const steer = steerInputForRoadWheelDeg(2.6);
    h.run(2.0, (t) => ({ ...NEUTRAL, steer: t < 1.0 ? steer : -steer }));
    return h.samples.map((s) => [
      s.speedKmh, s.yawRad, s.rollRad, s.yawRateRadS,
      ...s.wheels.flatMap((w) => [w.fzN, w.fxN, w.fyN, w.slipAngleRad, w.slipRatio]),
    ]);
  };
  const a = run();
  const b = run();
  let maxDelta = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    for (let j = 0; j < Math.min(a[i].length, b[i].length); j++) {
      maxDelta = Math.max(maxDelta, Math.abs(a[i][j] - b[i][j]));
    }
  }
  const passed = a.length === b.length && maxDelta < 1e-12;
  return {
    id: 'determinism',
    name: 'Deterministic fixed-step replay',
    status: passed ? 'PASS' : 'FAIL',
    validationClass: 'internal-regression',
    blocking: true,
    summary: passed ? 'Identical scripted inputs reproduced identical 120 Hz physics telemetry.' : 'Repeated scripted runs diverged.',
    metrics: { sampleCount: a.length, maxAbsoluteReplayDelta: maxDelta, fixedDtSec: DT },
    diagnostics: passed ? [] : ['Investigate non-deterministic state, time-dependent inputs, or unreset subsystem energy.'],
  };
}

function testStaticLoads(): ValidationResult {
  const h = new DeterministicHarness();
  h.reset();
  h.run(1.0, () => NEUTRAL);
  const s = last(h.samples);
  const loads = s.wheels.map((w) => w.fzN);
  const total = loads.reduce((a, b) => a + b, 0);
  const front = loads[0] + loads[1];
  const rear = loads[2] + loads[3];
  const left = loads[0] + loads[2];
  const right = loads[1] + loads[3];
  const weight = BASE_CONFIG.mass * G;
  const totalError = Math.abs(total - weight) / weight;
  const measuredFrontFraction = total > 0 ? front / total : 0;
  const frontFractionError = Math.abs(measuredFrontFraction - BASE_CONFIG.weightDistributionFront);
  const sideBias = total > 0 ? Math.abs(left - right) / total : 1;
  const speed = s.speedMs;
  const pass = totalError < 0.012 && frontFractionError < 0.015 && sideBias < 0.01 && speed < 0.02 && h.anomalies.length === 0;
  return {
    id: 'static-loads',
    name: 'Static axle loading and equilibrium',
    status: pass ? 'PASS' : 'FAIL',
    validationClass: 'internal-regression',
    blocking: true,
    summary: `Measured front distribution ${(measuredFrontFraction * 100).toFixed(2)}% vs configured ${(BASE_CONFIG.weightDistributionFront * 100).toFixed(2)}%.`,
    metrics: {
      totalFzN: total,
      vehicleWeightN: weight,
      totalLoadErrorPercent: totalError * 100,
      frontLoadN: front,
      rearLoadN: rear,
      frontDistributionPercent: measuredFrontFraction * 100,
      configuredFrontDistributionPercent: BASE_CONFIG.weightDistributionFront * 100,
      leftRightStaticBiasPercent: sideBias * 100,
      residualSpeedMs: speed,
      FL_Fz_N: loads[0], FR_Fz_N: loads[1], RL_Fz_N: loads[2], RR_Fz_N: loads[3],
    },
    diagnostics: [...h.anomalies, ...(pass ? [] : ['Check CG longitudinal location, suspension preload/equilibrium, and vertical-force balance before tuning springs.'])],
    telemetry: h.samples,
  };
}

function testMassPropertiesAndMoments(): ValidationResult {
  const props = deriveChassisMassProperties(BASE_CONFIG);
  const yawForceN = 6000;
  const yawMomentNm = props.cgToFrontAxle * yawForceN;
  const body = new RigidBody({
    mass: BASE_CONFIG.mass,
    inertia: PhysicsMath.vec3Clone(props.inertia),
    centerOfGravityHeight: BASE_CONFIG.centerOfGravityHeight,
  });
  body.addBodyForceAtPoint(
    PhysicsMath.vec3(yawForceN, 0, 0),
    PhysicsMath.vec3(0, -BASE_CONFIG.centerOfGravityHeight, props.cgToFrontAxle)
  );
  body.integrate(DT);
  const directExpectedYawAlpha = yawMomentNm / props.inertia.y;
  const directResidual = Math.abs(body.angularAcceleration.y - directExpectedYawAlpha);

  const h = new DeterministicHarness({ startSpeedKmh: 80 });
  const steer = steerInputForRoadWheelDeg(3.0);
  h.run(0.8, () => ({ ...NEUTRAL, steer }));
  const active = h.samples.filter((s) => Math.abs(s.reconstructedMomentNm.yaw) > 800);
  const relResiduals = active.map((s) => {
    const predicted = s.predictedAngularAccelRadS2.yaw;
    return Math.abs(s.yawAccelRadS2 - predicted) / Math.max(0.2, Math.abs(predicted));
  });
  const medianLiveResidual = percentile(relResiduals, 0.5);
  const p90LiveResidual = percentile(relResiduals, 0.9);
  const pass = directResidual < 1e-9 && medianLiveResidual < 0.15 && p90LiveResidual < 0.35 && h.anomalies.length === 0;

  return {
    id: 'mass-properties-moments',
    name: 'CG, inertia tensor, r × F and live yaw-moment closure',
    status: pass ? 'PASS' : 'FAIL',
    validationClass: 'engineering-plausibility',
    blocking: true,
    summary: `Yaw inertia ${props.inertia.y.toFixed(0)} kg·m²; live median |αy − Mz/Izz| residual ${(medianLiveResidual * 100).toFixed(1)}%.`,
    metrics: {
      massKg: props.mass,
      cgHeightM: BASE_CONFIG.centerOfGravityHeight,
      cgToFrontAxleM: props.cgToFrontAxle,
      cgToRearAxleM: props.cgToRearAxle,
      pitchInertiaKgM2: props.inertia.x,
      yawInertiaKgM2: props.inertia.y,
      rollInertiaKgM2: props.inertia.z,
      directYawMomentNm: yawMomentNm,
      directYawAlphaMeasuredRadS2: body.angularAcceleration.y,
      directYawAlphaExpectedRadS2: directExpectedYawAlpha,
      directYawAlphaResidual: directResidual,
      liveMomentClosureMedianErrorPercent: medianLiveResidual * 100,
      liveMomentClosureP90ErrorPercent: p90LiveResidual * 100,
    },
    diagnostics: [...h.anomalies, ...(pass ? [] : ['If live Mz closure fails, inspect force application points, contact-patch force transforms, aligning moment, CG origin, and Izz before changing tire grip.'])],
    telemetry: h.samples,
  };
}

function testAcceleration(): ValidationResult {
  const h = new DeterministicHarness({ assists: { absMode: BASE_CONFIG.absMode, tcsMode: BASE_CONFIG.tcsMode } });
  h.reset();
  // Use the normal launch-control path: preload powertrain against the brake, then release.
  for (let i = 0; i < Math.round(0.8 / DT); i++) h.sim.stepExplicit({ ...NEUTRAL, throttle: 1, brake: 0.8 }, 1);
  h.samples = [];
  h.anomalies = [];

  const milestones = [30, 50, 60 * MPH_TO_KMH, 100, 120];
  const times: Record<number, number | null> = Object.fromEntries(milestones.map((m) => [m, null]));
  let quarterMileTime: number | null = null;
  let quarterMileTrapMph: number | null = null;
  const start = { ...h.sim.vehicle.rigidBody.position };
  let traveled = 0;
  let prev = { ...start };
  const maxSeconds = 13;
  const steps = Math.round(maxSeconds / DT);

  for (let i = 0; i < steps; i++) {
    const sample = h.step({ ...NEUTRAL, throttle: 1 });
    autoShiftIfNeeded(h);
    for (const milestone of milestones) {
      if (times[milestone] === null && sample.speedKmh >= milestone) times[milestone] = sample.t + DT;
    }
    const pos = h.sim.vehicle.rigidBody.position;
    traveled += Math.hypot(pos.x - prev.x, pos.z - prev.z);
    prev = { ...pos };
    if (quarterMileTime === null && traveled >= 402.336) {
      quarterMileTime = sample.t + DT;
      quarterMileTrapMph = sample.speedKmh / MPH_TO_KMH;
    }
    if (times[120] !== null && quarterMileTime !== null) break;
  }

  const zeroTo100 = times[100] ?? Number.NaN;
  const zeroTo60Mph = times[60 * MPH_TO_KMH] ?? Number.NaN;
  const ref100 = referenceStatus('zeroTo100KmhSec', zeroTo100);
  const ref60True = referenceStatus('zeroTo60MphTrueStartSec', zeroTo60Mph);
  const peakAccelG = Math.max(...h.samples.map((s) => s.longitudinalG));
  const peakDrivenSlip = Math.max(...h.samples.flatMap((s) => s.wheels.map((w) => Math.abs(w.slipRatio))));
  const peakPitchDeg = maxAbs(h.samples.map((s) => s.pitchRad * RAD_TO_DEG));
  const status = combineStatuses([ref100.status, ref60True.status]);

  return {
    id: 'acceleration',
    name: 'Standing-start acceleration and longitudinal load transfer',
    status,
    validationClass: 'hard',
    blocking: false,
    summary: Number.isFinite(zeroTo100) ? `0–100 km/h ${zeroTo100.toFixed(3)} s; normal powertrain/TCS path only.` : 'Vehicle did not reach 100 km/h within the validation window.',
    metrics: {
      zeroTo30KmhSec: times[30],
      zeroTo50KmhSec: times[50],
      zeroTo60MphTrueStartSec: zeroTo60Mph,
      zeroTo100KmhSec: zeroTo100,
      zeroTo120KmhSec: times[120],
      quarterMileSec: quarterMileTime,
      quarterMileTrapMph,
      peakLongitudinalG: peakAccelG,
      peakDrivenSlipRatioAbs: peakDrivenSlip,
      peakPitchDeg,
      zeroTo100ReferenceErrorPercent: ref100.errorPercent ?? null,
    },
    diagnostics: [
      ...h.anomalies,
      ...(status === 'FAIL' ? ['Trace throttle → driveline torque → tire Fx → load transfer → acceleration before changing torque or grip coefficients.'] : []),
    ],
    reference: ref100.reference,
    telemetry: h.samples,
  };
}

function runBraking(startSpeedKmh: number) {
  const h = new DeterministicHarness({ startSpeedKmh, assists: { absMode: BASE_CONFIG.absMode, tcsMode: BASE_CONFIG.tcsMode } });
  h.samples = [];
  h.anomalies = [];
  const start = { ...h.sim.vehicle.rigidBody.position };
  let distance = 0;
  let prev = { ...start };
  const maxSteps = Math.round(8 / DT);
  for (let i = 0; i < maxSteps; i++) {
    const s = h.step({ ...NEUTRAL, brake: 1 });
    const pos = h.sim.vehicle.rigidBody.position;
    distance += Math.hypot(pos.x - prev.x, pos.z - prev.z);
    prev = { ...pos };
    if (s.speedKmh <= 1) break;
  }
  const stopTime = h.samples.length * DT;
  const peakDecelG = Math.abs(Math.min(...h.samples.map((s) => s.longitudinalG)));
  const avgDecel = (startSpeedKmh / 3.6) / Math.max(stopTime, DT);
  const absFraction = h.samples.filter((s) => s.absActive).length / Math.max(1, h.samples.length);
  return { h, distance, stopTime, peakDecelG, avgDecel, absFraction };
}

function testBraking(): ValidationResult {
  const kmh100 = runBraking(100);
  const mph70 = runBraking(70 * MPH_TO_KMH);
  const mph100 = runBraking(100 * MPH_TO_KMH);
  const ref70 = referenceStatus('braking70To0MphFt', mph70.distance * M_TO_FT);
  const ref100mph = referenceStatus('braking100To0MphFt', mph100.distance * M_TO_FT);
  const status = combineStatuses([ref70.status, ref100mph.status]);
  const allAnomalies = [...new Set([...kmh100.h.anomalies, ...mph70.h.anomalies, ...mph100.h.anomalies])];
  return {
    id: 'braking',
    name: 'Braking validation: 100–0 km/h, 70–0 mph and 100–0 mph',
    status,
    validationClass: 'hard',
    blocking: false,
    summary: `100–0 km/h ${kmh100.distance.toFixed(2)} m; 70–0 mph ${(mph70.distance * M_TO_FT).toFixed(1)} ft; 100–0 mph ${(mph100.distance * M_TO_FT).toFixed(1)} ft.`,
    metrics: {
      braking100To0KmhM: kmh100.distance,
      braking100To0KmhSec: kmh100.stopTime,
      braking100To0KmhPeakDecelG: kmh100.peakDecelG,
      braking100To0KmhAverageDecelMs2: kmh100.avgDecel,
      braking70To0MphFt: mph70.distance * M_TO_FT,
      braking70To0MphSec: mph70.stopTime,
      braking100To0MphFt: mph100.distance * M_TO_FT,
      braking100To0MphSec: mph100.stopTime,
      absActiveFraction100Kmh: kmh100.absFraction,
      peakBrakePitchDeg: maxAbs(kmh100.h.samples.map((s) => s.pitchRad * RAD_TO_DEG)),
      frontLoadPeakN: Math.max(...kmh100.h.samples.map((s) => s.wheels[0].fzN + s.wheels[1].fzN)),
      rearLoadMinimumN: Math.min(...kmh100.h.samples.map((s) => s.wheels[2].fzN + s.wheels[3].fzN)),
    },
    diagnostics: [
      ...allAnomalies,
      ...(status === 'FAIL' ? ['Inspect brake torque, ABS slip regulation, tire longitudinal force/slip curve and CG-driven load transfer; do not add a braking multiplier.'] : []),
      'No direct 100–0 km/h instrumented reference is stored yet; that metric remains descriptive while 70–0 and 100–0 mph provide hard anchors.',
    ],
    reference: ref70.reference,
    telemetry: kmh100.h.samples,
  };
}

function runCirclePoint(radiusM: number, targetAyG: number, durationSec = 4.2) {
  const speedMs = Math.sqrt(Math.max(0.01, targetAyG) * G * radiusM);
  const h = new DeterministicHarness();
  h.reset(-radiusM, 0, 0, 0);
  h.setSpeed(speedMs);
  h.samples = [];
  h.anomalies = [];
  const kinematicSteer = Math.atan(BASE_CONFIG.wheelbase / radiusM);

  h.run(durationSec, (_t, harness) => {
    const state = harness.sim.vehicle.getState() as any;
    const x = harness.sim.vehicle.rigidBody.position.x;
    const z = harness.sim.vehicle.rigidBody.position.z;
    const radiusNow = Math.hypot(x, z);
    const desiredYaw = Math.atan2(z, -x);
    const headingError = wrapAngle(desiredYaw - state.yaw);
    const radialError = (radiusNow - radiusM) / radiusM;
    // One generic scripted-driver controller for every skidpad point. It adjusts
    // steering input only; it never acts on chassis pose, velocity, force or yaw.
    const roadSteer = kinematicSteer + 1.35 * headingError + 0.85 * radialError;
    const steer = clamp(roadSteer / BASE_CONFIG.maxSteerAngle, -1, 1);
    const speedError = speedMs - state.speedMs;
    const throttle = clamp(speedError * 0.22 + 0.08, 0, 0.55);
    const brake = clamp(-speedError * 0.18, 0, 0.45);
    return { ...NEUTRAL, steer, throttle, brake };
  });

  const tail = h.samples.slice(-Math.round(1.0 / DT));
  const latG = mean(tail.map((s) => Math.abs(s.lateralG)));
  const yawRate = mean(tail.map((s) => Math.abs(s.yawRateRadS)));
  const speed = mean(tail.map((s) => s.speedMs));
  const actualRadius = yawRate > 1e-5 ? speed / yawRate : Infinity;
  const roadSteerDeg = mean(tail.map((s) => Math.abs((s.roadWheelAnglesRad[0] + s.roadWheelAnglesRad[1]) * 0.5) * RAD_TO_DEG));
  const steeringWheelDeg = mean(tail.map((s) => Math.abs(s.steeringWheelAngleRad ?? 0) * RAD_TO_DEG));
  const rollDeg = mean(tail.map((s) => Math.abs(s.rollRad) * RAD_TO_DEG));
  const sideslipDeg = mean(tail.map((s) => Math.abs(s.sideslipRad) * RAD_TO_DEG));
  const loads = [0, 1, 2, 3].map((i) => mean(tail.map((s) => s.wheels[i].fzN)));
  const fys = [0, 1, 2, 3].map((i) => mean(tail.map((s) => Math.abs(s.wheels[i].fyN))));
  const slips = [0, 1, 2, 3].map((i) => mean(tail.map((s) => Math.abs(s.wheels[i].slipAngleRad) * RAD_TO_DEG)));
  return {
    radiusM, targetAyG, latG, yawRate, speedKmh: speed * 3.6, actualRadius, roadSteerDeg, steeringWheelDeg,
    rollDeg, sideslipDeg, loads, fys, slips, h,
  };
}

function testSkidpad(): ValidationResult {
  const radii = [20, 30, 45.72, 50, 100];
  const targetGs = [0.10, 0.20, 0.30, 0.40, 0.50, 0.60, 0.70, 0.80, 0.90, 0.98, 1.05];
  const points: any[] = [];
  const representativeTraces: ValidationSample[] = [];
  const anomalies: string[] = [];

  for (const radius of radii) {
    for (const targetG of targetGs) {
      if (radius !== 45.72 && ![0.2, 0.4, 0.6, 0.8, 0.98].includes(targetG)) continue;
      const point = runCirclePoint(radius, targetG);
      points.push(point);
      anomalies.push(...point.h.anomalies);
      if (radius === 45.72 && Math.abs(targetG - 0.98) < 1e-6) representativeTraces.push(...point.h.samples);
    }
  }

  const cdPoints = points.filter((p) => p.radiusM === 45.72);
  const peakStableG = Math.max(...cdPoints.map((p) => p.latG));
  const ref = referenceStatus('skidpadPeakG', peakStableG);
  const gradientPoints = cdPoints.filter((p) => p.latG >= 0.18 && p.latG <= 0.75);
  const rollGradient = linearSlope(gradientPoints.map((p) => ({ x: p.latG, y: p.rollDeg })));
  const kinematicDeg = Math.atan(BASE_CONFIG.wheelbase / 45.72) * RAD_TO_DEG;
  const understeerGradientRoadWheel = linearSlope(gradientPoints.map((p) => ({
    x: p.latG,
    y: p.roadSteerDeg - kinematicDeg,
  })));
  const steeringSlope = linearSlope(gradientPoints.map((p) => ({ x: p.latG, y: p.steeringWheelDeg })));
  const loadCheckPoint = cdPoints.reduce((best, p) => Math.abs(p.latG - 0.6) < Math.abs(best.latG - 0.6) ? p : best, cdPoints[0]);
  const totalLoad = loadCheckPoint.loads.reduce((a: number, b: number) => a + b, 0);
  const rightLoad = loadCheckPoint.loads[1] + loadCheckPoint.loads[3];
  const leftLoad = loadCheckPoint.loads[0] + loadCheckPoint.loads[2];
  const outsideLoadCorrect = rightLoad > leftLoad;
  const status = ref.status === 'PASS' && !outsideLoadCorrect ? 'FAIL' : ref.status;

  const sweepRows = points.map((p) => ({
    radius_m: p.radiusM,
    target_lateral_g: p.targetAyG,
    measured_lateral_g: p.latG,
    speed_kmh: p.speedKmh,
    measured_radius_m: p.actualRadius,
    road_wheel_steer_deg: p.roadSteerDeg,
    estimated_or_simulated_steering_wheel_deg: p.steeringWheelDeg,
    roll_deg: p.rollDeg,
    sideslip_deg: p.sideslipDeg,
    fz_fl_n: p.loads[0], fz_fr_n: p.loads[1], fz_rl_n: p.loads[2], fz_rr_n: p.loads[3],
    fy_fl_n: p.fys[0], fy_fr_n: p.fys[1], fy_rl_n: p.fys[2], fy_rr_n: p.fys[3],
    slip_fl_deg: p.slips[0], slip_fr_deg: p.slips[1], slip_rl_deg: p.slips[2], slip_rr_deg: p.slips[3],
  }));
  (testSkidpad as any).sweepRows = sweepRows;

  return {
    id: 'skidpad',
    name: 'Constant-radius skidpad, steering demand, understeer and load transfer',
    status,
    validationClass: 'hard',
    blocking: false,
    summary: `45.72 m (300-ft diameter) sweep reached ${peakStableG.toFixed(3)} g; roll gradient ${Number.isFinite(rollGradient) ? rollGradient.toFixed(2) : 'n/a'} deg/g.`,
    metrics: {
      skidpadPeakG: peakStableG,
      rollGradientDegPerG: rollGradient,
      roadWheelUndersteerGradientDegPerG: understeerGradientRoadWheel,
      steeringWheelAngleSlopeDegPerG: steeringSlope,
      loadCheckAtG: loadCheckPoint.latG,
      FL_Fz_N: loadCheckPoint.loads[0], FR_Fz_N: loadCheckPoint.loads[1], RL_Fz_N: loadCheckPoint.loads[2], RR_Fz_N: loadCheckPoint.loads[3],
      totalFzN: totalLoad,
      outsideRightLoadN: rightLoad,
      insideLeftLoadN: leftLoad,
      outsideLoadTransferDirectionCorrect: outsideLoadCorrect ? 1 : 0,
    },
    diagnostics: [
      ...new Set(anomalies),
      ...(!outsideLoadCorrect ? ['Left-turn load transfer is reversed: investigate force/moment signs and suspension convention immediately.'] : []),
      'Steering-wheel angle is marked derived-overall-ratio on this branch until the physical steering-rack PR is integrated; do not treat it as measured rack telemetry.',
      'No external roll-gradient or understeer-gradient measurement is stored yet; those metrics are reported as NO REFERENCE DATA even though the skidpad peak has a hard C/D anchor.',
    ],
    reference: ref.reference,
    telemetry: representativeTraces,
  };
}

function runStepSteer(speedKmh: number) {
  const h = new DeterministicHarness({ startSpeedKmh: speedKmh });
  h.samples = [];
  h.anomalies = [];
  const steer = steerInputForRoadWheelDeg(3.0);
  h.run(3.0, (t) => ({ ...NEUTRAL, steer: t < 1.5 ? steer : 0 }));
  const hold = h.samples.slice(Math.round(0.8 / DT), Math.round(1.5 / DT));
  const steadyYaw = mean(hold.map((s) => Math.abs(s.yawRateRadS)));
  const steadySteer = mean(hold.map((s) => Math.abs((s.roadWheelAnglesRad[0] + s.roadWheelAnglesRad[1]) * 0.5)));
  const steer10 = thresholdCrossing(h.samples, (s) => Math.abs((s.roadWheelAnglesRad[0] + s.roadWheelAnglesRad[1]) * 0.5), steadySteer * 0.10);
  const yaw10 = thresholdCrossing(h.samples, (s) => Math.abs(s.yawRateRadS), steadyYaw * 0.10);
  const yaw90 = thresholdCrossing(h.samples, (s) => Math.abs(s.yawRateRadS), steadyYaw * 0.90);
  const peakYaw = Math.max(...h.samples.slice(0, Math.round(1.5 / DT)).map((s) => Math.abs(s.yawRateRadS)));
  const overshoot = steadyYaw > 1e-5 ? (peakYaw / steadyYaw - 1) * 100 : 0;
  const frontSlipSteady = mean(hold.map((s) => 0.5 * (Math.abs(s.wheels[0].slipAngleRad) + Math.abs(s.wheels[1].slipAngleRad))));
  const slip10 = thresholdCrossing(h.samples, (s) => 0.5 * (Math.abs(s.wheels[0].slipAngleRad) + Math.abs(s.wheels[1].slipAngleRad)), frontSlipSteady * 0.10);
  const releaseIndex = Math.round(1.5 / DT);
  let settlingTime: number | null = null;
  const threshold = steadyYaw * 0.05;
  const window = Math.round(0.2 / DT);
  for (let i = releaseIndex; i < h.samples.length - window; i++) {
    if (h.samples.slice(i, i + window).every((s) => Math.abs(s.yawRateRadS) <= threshold)) {
      settlingTime = h.samples[i].t - 1.5;
      break;
    }
  }
  return {
    speedKmh, h, steadyYaw, steadySteer, steer10, slip10, yaw10, yaw90,
    steeringDelaySec: steer10 ?? null,
    tireSlipDelaySec: slip10 ?? null,
    yawDelaySec: yaw10 ?? null,
    yawRiseTimeSec: yaw10 !== null && yaw90 !== null ? yaw90 - yaw10 : null,
    yawOvershootPercent: overshoot,
    settlingTimeSec: settlingTime,
    yawRateGain: steadySteer > 1e-6 ? steadyYaw / steadySteer : null,
  };
}

function testStepSteer(): ValidationResult {
  const runs = [30, 50, 80, 100].map(runStepSteer);
  const run80 = runs.find((r) => r.speedKmh === 80)!;
  const chronologyGood = runs.every((r) =>
    r.steer10 !== null && r.slip10 !== null && r.yaw10 !== null &&
    r.steer10 <= r.yaw10 + 0.04 && r.yaw10 > 0
  );
  const bounded = runs.every((r) => r.h.anomalies.length === 0 && (r.yawOvershootPercent ?? 0) < 120);
  const status: ValidationStatus = chronologyGood && bounded ? 'NO REFERENCE DATA' : 'FAIL';
  return {
    id: 'step-steer',
    name: 'Step-steer response and yaw-rate gain',
    status,
    validationClass: 'internal-regression',
    blocking: !chronologyGood || !bounded,
    summary: `80 km/h yaw delay ${run80.yawDelaySec?.toFixed(3) ?? 'n/a'} s, 10–90 rise ${run80.yawRiseTimeSec?.toFixed(3) ?? 'n/a'} s, overshoot ${run80.yawOvershootPercent.toFixed(1)}%.`,
    metrics: Object.fromEntries(runs.flatMap((r) => [
      [`${r.speedKmh}Kmh_yawDelaySec`, r.yawDelaySec],
      [`${r.speedKmh}Kmh_yawRiseTimeSec`, r.yawRiseTimeSec],
      [`${r.speedKmh}Kmh_yawOvershootPercent`, r.yawOvershootPercent],
      [`${r.speedKmh}Kmh_settlingTimeSec`, r.settlingTimeSec],
      [`${r.speedKmh}Kmh_yawRateGain`, r.yawRateGain],
    ])),
    diagnostics: [
      ...new Set(runs.flatMap((r) => r.h.anomalies)),
      ...(!chronologyGood ? ['Response chronology is wrong: inspect steering response, tire relaxation, force buildup and chassis inertia rather than adding input smoothing.'] : []),
      'REFERENCE DATA NEEDED for instrumented G90 step-steer delay, rise time, overshoot and yaw-rate gain.',
    ],
    telemetry: run80.h.samples,
  };
}

function testRapidReversal(): ValidationResult {
  const h = new DeterministicHarness({ startSpeedKmh: 80 });
  h.samples = [];
  h.anomalies = [];
  const steer = steerInputForRoadWheelDeg(4.2);
  h.run(3.0, (t) => {
    let command = 0;
    if (t >= 0.25 && t < 0.75) command = steer;
    else if (t >= 0.75 && t < 1.25) command = -steer;
    else if (t >= 1.25 && t < 1.55) command = -steer;
    return { ...NEUTRAL, steer: command };
  });
  const maxYawDegS = maxAbs(h.samples.map((s) => s.yawRateRadS * RAD_TO_DEG));
  const maxRollDeg = maxAbs(h.samples.map((s) => s.rollRad * RAD_TO_DEG));
  const maxLoad = Math.max(...h.samples.flatMap((s) => s.wheels.map((w) => w.fzN)));
  const minLoad = Math.min(...h.samples.flatMap((s) => s.wheels.map((w) => w.fzN)));
  const pass = h.anomalies.length === 0 && maxRollDeg < 12 && maxYawDegS < 140 && minLoad >= -1;
  return {
    id: 'rapid-reversal',
    name: 'Sine-with-dwell style rapid steering reversal',
    status: pass ? 'PASS' : 'FAIL',
    validationClass: 'internal-regression',
    blocking: true,
    summary: `Peak yaw ${maxYawDegS.toFixed(1)} deg/s, peak roll ${maxRollDeg.toFixed(2)}°, tire load range ${minLoad.toFixed(0)}–${maxLoad.toFixed(0)} N.`,
    metrics: { maxYawRateDegS: maxYawDegS, maxRollDeg, minTireLoadN: minLoad, maxTireLoadN: maxLoad },
    diagnostics: [...h.anomalies, ...(pass ? [] : ['Inspect steering reversal stability, tire force continuity, suspension travel and rigid-body angular integration.'])],
    telemetry: h.samples,
  };
}

function testSlalom(): ValidationResult {
  const spacings = [18, 22, 30];
  const speedKmh = 80;
  const speedMs = speedKmh / 3.6;
  const results: any[] = [];
  for (const spacing of spacings) {
    const h = new DeterministicHarness({ startSpeedKmh: speedKmh });
    h.samples = [];
    h.anomalies = [];
    const frequencyHz = speedMs / (2 * spacing);
    const amplitude = steerInputForRoadWheelDeg(3.2);
    h.run(6.0, (t) => ({ ...NEUTRAL, steer: amplitude * Math.sin(2 * Math.PI * frequencyHz * t) }));
    results.push({
      spacing,
      frequencyHz,
      h,
      peakLatG: maxAbs(h.samples.map((s) => s.lateralG)),
      peakYawDegS: maxAbs(h.samples.map((s) => s.yawRateRadS * RAD_TO_DEG)),
      peakRollDeg: maxAbs(h.samples.map((s) => s.rollRad * RAD_TO_DEG)),
      peakSteeringRateDegS: maxAbs(h.samples.map((s) => (s.steeringWheelAngularVelocityRadS ?? 0) * RAD_TO_DEG)),
    });
  }
  const anomalies = [...new Set(results.flatMap((r) => r.h.anomalies))];
  const pass = anomalies.length === 0 && results.every((r) => r.peakRollDeg < 10 && r.peakYawDegS < 150);
  return {
    id: 'slalom',
    name: 'Repeatable 18/22/30 m slalom transient response',
    status: pass ? 'NO REFERENCE DATA' : 'FAIL',
    validationClass: 'internal-regression',
    blocking: !pass,
    summary: `80 km/h scripted slalom remains ${pass ? 'numerically coherent' : 'unstable'} across all three cone spacings.`,
    metrics: Object.fromEntries(results.flatMap((r) => [
      [`${r.spacing}m_peakLateralG`, r.peakLatG],
      [`${r.spacing}m_peakYawRateDegS`, r.peakYawDegS],
      [`${r.spacing}m_peakRollDeg`, r.peakRollDeg],
      [`${r.spacing}m_steeringFrequencyHz`, r.frequencyHz],
    ])),
    diagnostics: [...anomalies, 'REFERENCE DATA NEEDED for instrumented G90 slalom speed and transient traces.'],
    telemetry: results.find((r) => r.spacing === 22).h.samples,
  };
}

function runBump(kind: 'bump-left' | 'bump-full', axle: 'front' | 'rear') {
  const surface = { kind, bumpStartZ: 20, bumpLengthM: 0.55, bumpHeightM: 0.025, friction: 1.0 } as ValidationSurfaceOptions;
  const h = new DeterministicHarness({ surface });
  const props = h.sim.vehicle.chassisMassProperties;
  const z = axle === 'front'
    ? 20 - props.cgToFrontAxle - 1.0
    : 20 + props.cgToRearAxle - 0.9;
  h.reset(0, z, 0, 0);
  h.setSpeed(30 / 3.6);
  h.samples = [];
  h.anomalies = [];
  h.run(2.5, () => ({ ...NEUTRAL, throttle: 0.08 }));
  const wheelIndex = axle === 'front' ? 0 : 2;
  const baseWheel = h.samples[0]?.wheels[wheelIndex].suspensionDisplacementM ?? 0;
  const baseHeave = h.samples[0]?.position.y ?? 0;
  const wheelSignal = h.samples.map((s) => s.wheels[wheelIndex].suspensionDisplacementM - baseWheel);
  const heaveSignal = h.samples.map((s) => s.position.y - baseHeave);
  const wheelHopHz = dominantFrequency(wheelSignal, 120, 4, 25);
  const bodyHeaveHz = dominantFrequency(heaveSignal, 120, 0.5, 5);
  const wheelPeak = maxAbs(wheelSignal);
  const bodyPeak = maxAbs(heaveSignal);
  const wheelResponseThreshold = Math.max(0.0005, wheelPeak * 0.10);
  const bodyResponseThreshold = Math.max(0.0003, bodyPeak * 0.10);
  const wheelResponse = h.samples.find((s) => Math.abs(s.wheels[wheelIndex].suspensionDisplacementM - baseWheel) >= wheelResponseThreshold)?.t ?? null;
  const bodyResponse = h.samples.find((s) => Math.abs(s.position.y - baseHeave) >= bodyResponseThreshold)?.t ?? null;
  return { h, axle, wheelIndex, wheelHopHz, bodyHeaveHz, wheelResponse, bodyResponse, wheelPeak, bodyPeak };
}

function testBumpResponse(): ValidationResult {
  const frontSingle = runBump('bump-left', 'front');
  const rearSingle = runBump('bump-left', 'rear');
  const full = runBump('bump-full', 'front');
  const sequenceGood = [frontSingle, rearSingle].every((r) =>
    r.wheelResponse !== null && r.bodyResponse !== null && r.wheelResponse <= r.bodyResponse + 0.03
  );
  const anomalies = [...new Set([frontSingle, rearSingle, full].flatMap((r) => r.h.anomalies))];
  const pass = sequenceGood && anomalies.length === 0;
  return {
    id: 'bump-response',
    name: 'Single-wheel/full-width bump and wheel-hop response',
    status: pass ? 'NO REFERENCE DATA' : 'FAIL',
    validationClass: 'engineering-plausibility',
    blocking: !pass,
    summary: `Front wheel-hop estimate ${frontSingle.wheelHopHz?.toFixed(2) ?? 'n/a'} Hz; body-heave estimate ${frontSingle.bodyHeaveHz?.toFixed(2) ?? 'n/a'} Hz.`,
    metrics: {
      frontWheelHopHz: frontSingle.wheelHopHz,
      frontBodyHeaveHz: frontSingle.bodyHeaveHz,
      rearWheelHopHz: rearSingle.wheelHopHz,
      rearBodyHeaveHz: rearSingle.bodyHeaveHz,
      frontWheelResponseSec: frontSingle.wheelResponse,
      frontBodyResponseSec: frontSingle.bodyResponse,
      rearWheelResponseSec: rearSingle.wheelResponse,
      rearBodyResponseSec: rearSingle.bodyResponse,
      frontWheelPeakTravelM: frontSingle.wheelPeak,
      frontBodyPeakHeaveM: frontSingle.bodyPeak,
      wheelBeforeBodySequenceCorrect: sequenceGood ? 1 : 0,
    },
    diagnostics: [
      ...anomalies,
      ...(!sequenceGood ? ['Road input is reaching chassis too early relative to wheel/suspension response; inspect the road → tire/unsprung → spring/damper → chassis force path.'] : []),
      'REFERENCE DATA NEEDED for G90 wheel-hop, heave frequency and damping ratios.',
    ],
    telemetry: frontSingle.h.samples,
  };
}

function testLiftOffAndThrottleOn(): ValidationResult {
  const h = new DeterministicHarness();
  const radius = 50;
  const speedMs = Math.sqrt(0.5 * G * radius);
  h.reset(-radius, 0, 0, 0);
  h.setSpeed(speedMs);
  h.samples = [];
  h.anomalies = [];
  const baseSteer = Math.atan(BASE_CONFIG.wheelbase / radius) / BASE_CONFIG.maxSteerAngle;

  // Stabilize the corner with a modest physical throttle input.
  h.run(2.5, () => ({ ...NEUTRAL, steer: baseSteer, throttle: 0.18 }));
  const beforeLift = last(h.samples);
  const liftStart = h.samples.length;
  h.run(1.0, () => ({ ...NEUTRAL, steer: baseSteer, throttle: 0 }));
  const liftTrace = h.samples.slice(liftStart);
  const afterLift = last(liftTrace);
  const yawDeltaLiftDegS = (Math.abs(afterLift.yawRateRadS) - Math.abs(beforeLift.yawRateRadS)) * RAD_TO_DEG;
  const frontLoadDeltaLift = (afterLift.wheels[0].fzN + afterLift.wheels[1].fzN) - (beforeLift.wheels[0].fzN + beforeLift.wheels[1].fzN);

  const throttleStart = h.samples.length;
  h.run(1.0, () => ({ ...NEUTRAL, steer: baseSteer, throttle: 0.70 }));
  const throttleTrace = h.samples.slice(throttleStart);
  const peakRearLong = Math.max(...throttleTrace.map((s) => Math.abs(s.wheels[2].fxN) + Math.abs(s.wheels[3].fxN)));
  const minRearLat = Math.min(...throttleTrace.map((s) => Math.abs(s.wheels[2].fyN) + Math.abs(s.wheels[3].fyN)));
  const peakRearUtil = Math.max(...throttleTrace.flatMap((s) => [s.wheels[2].gripUtilization, s.wheels[3].gripUtilization]));
  const pass = h.anomalies.length === 0 && Math.abs(yawDeltaLiftDegS) < 100 && peakRearUtil < 1.6;
  return {
    id: 'lift-throttle',
    name: 'Lift-off and throttle-on cornering / combined slip',
    status: pass ? 'NO REFERENCE DATA' : 'FAIL',
    validationClass: 'engineering-plausibility',
    blocking: !pass,
    summary: `Lift-off yaw-rate change ${yawDeltaLiftDegS.toFixed(2)} deg/s; throttle-on rear longitudinal force peak ${peakRearLong.toFixed(0)} N.`,
    metrics: {
      liftOffYawRateChangeDegS: yawDeltaLiftDegS,
      liftOffFrontLoadChangeN: frontLoadDeltaLift,
      throttleOnPeakRearLongitudinalForceN: peakRearLong,
      throttleOnMinimumRearLateralForceN: minRearLat,
      throttleOnPeakRearGripUtilization: peakRearUtil,
    },
    diagnostics: [...h.anomalies, 'REFERENCE DATA NEEDED for G90 lift-off and throttle-on transient telemetry. Behavior is reported, not forced toward oversteer or neutrality.'],
    telemetry: h.samples,
  };
}

function kineticEnergy(h: DeterministicHarness): number {
  const rb = h.sim.vehicle.rigidBody;
  const v2 = PhysicsMath.vec3Dot(rb.velocity, rb.velocity);
  const omega = rb.getLocalAngularVelocity();
  const I = rb.config.inertia;
  const translational = 0.5 * rb.config.mass * v2;
  const rotational = 0.5 * (I.x * omega.x ** 2 + I.y * omega.y ** 2 + I.z * omega.z ** 2);
  const wheelRot = h.sim.vehicle.wheels.reduce((sum, wheel: any) => sum + 0.5 * h.config.wheelInertia * wheel.angularVelocity ** 2, 0);
  return translational + rotational + wheelRot;
}

function testEnergyAndLowSpeedSanity(): ValidationResult {
  const coast = new DeterministicHarness({ startSpeedKmh: 30 });
  coast.samples = [];
  coast.anomalies = [];
  const e0 = kineticEnergy(coast);
  let maxEnergy = e0;
  coast.run(5, () => NEUTRAL);
  for (const _s of coast.samples) maxEnergy = Math.max(maxEnergy, kineticEnergy(coast));
  const coastFinalSpeed = last(coast.samples).speedKmh;

  const turn = new DeterministicHarness({ startSpeedKmh: 20 });
  turn.samples = [];
  turn.anomalies = [];
  const initialSpeed = 20;
  const steer = steerInputForRoadWheelDeg(12);
  turn.run(5, () => ({ ...NEUTRAL, steer }));
  const maxTurnSpeed = Math.max(...turn.samples.map((s) => s.speedKmh));
  const finalTurnSpeed = last(turn.samples).speedKmh;

  const rest = new DeterministicHarness();
  rest.samples = [];
  rest.anomalies = [];
  rest.run(2, () => ({ ...NEUTRAL, steer }));
  const maxRestYaw = maxAbs(rest.samples.map((s) => s.yawRateRadS * RAD_TO_DEG));
  const maxRestSpeed = Math.max(...rest.samples.map((s) => s.speedKmh));

  const energyGrowthPercent = e0 > 0 ? (maxEnergy / e0 - 1) * 100 : 0;
  const pass = energyGrowthPercent < 0.5 && coastFinalSpeed <= 30.05 && maxTurnSpeed <= initialSpeed + 0.6 && finalTurnSpeed <= initialSpeed + 0.2 && maxRestYaw < 0.25 && maxRestSpeed < 0.2 && [...coast.anomalies, ...turn.anomalies, ...rest.anomalies].length === 0;
  return {
    id: 'energy-sanity',
    name: 'Energy, coast-down and low-speed turning sanity checks',
    status: pass ? 'PASS' : 'FAIL',
    validationClass: 'internal-regression',
    blocking: true,
    summary: `No-throttle 20 km/h turn peak ${maxTurnSpeed.toFixed(2)} km/h; coast kinetic-energy growth ${energyGrowthPercent.toFixed(3)}%.`,
    metrics: {
      coastInitialEnergyJ: e0,
      coastMaxEnergyGrowthPercent: energyGrowthPercent,
      coastFinalSpeedKmh: coastFinalSpeed,
      lowSpeedTurnInitialKmh: initialSpeed,
      lowSpeedTurnPeakKmh: maxTurnSpeed,
      lowSpeedTurnFinalKmh: finalTurnSpeed,
      restSteeringPeakYawRateDegS: maxRestYaw,
      restSteeringPeakSpeedKmh: maxRestSpeed,
    },
    diagnostics: [
      ...new Set([...coast.anomalies, ...turn.anomalies, ...rest.anomalies]),
      ...(pass ? [] : ['Investigate tire-force direction, low-speed regularization, drivetrain feedback, rolling resistance and numerical energy injection before changing grip or damping.']),
    ],
    telemetry: turn.samples,
  };
}

const TESTS: Record<string, () => ValidationResult> = {
  determinism: testDeterminism,
  'static-loads': testStaticLoads,
  'mass-properties-moments': testMassPropertiesAndMoments,
  acceleration: testAcceleration,
  braking: testBraking,
  skidpad: testSkidpad,
  'step-steer': testStepSteer,
  'rapid-reversal': testRapidReversal,
  slalom: testSlalom,
  'bump-response': testBumpResponse,
  'lift-throttle': testLiftOffAndThrottleOn,
  'energy-sanity': testEnergyAndLowSpeedSanity,
};

function metricIndex(report: any): Record<string, number> {
  const result: Record<string, number> = {};
  for (const test of report.results ?? []) {
    for (const [key, value] of Object.entries(test.metrics ?? {})) {
      if (typeof value === 'number' && Number.isFinite(value)) result[`${test.id}.${key}`] = value;
    }
  }
  return result;
}

function regressionDeltas(current: any, baseline: any) {
  const currentIndex = metricIndex(current);
  const baselineIndex = metricIndex(baseline);
  return Object.keys(currentIndex)
    .filter((metric) => Number.isFinite(baselineIndex[metric]))
    .map((metric) => ({
      metric,
      before: baselineIndex[metric],
      after: currentIndex[metric],
      percent: Math.abs(baselineIndex[metric]) > 1e-12
        ? ((currentIndex[metric] - baselineIndex[metric]) / Math.abs(baselineIndex[metric])) * 100
        : null,
    }))
    .sort((a, b) => Math.abs((b.percent as number) ?? 0) - Math.abs((a.percent as number) ?? 0));
}

function writeResultArtifacts(result: ValidationResult, artifactDir: string) {
  const graphFiles: string[] = [];
  if (result.telemetry?.length) {
    result.telemetryFile = saveTelemetry(result.id, result.telemetry, artifactDir);
  }

  if (result.id === 'acceleration' && result.telemetry?.length) {
    const speedGraph = `${artifactDir}/acceleration-speed.svg`;
    writeLineChartSvg(speedGraph, {
      title: '2025 BMW M5 — standing-start acceleration',
      subtitle: 'Normal driveline, tire and TCS path; physics sampled at 120 Hz',
      xLabel: 'time (s)', yLabel: 'speed (km/h)',
      x: result.telemetry.map((s) => s.t),
      series: [{ name: 'speed', values: result.telemetry.map((s) => s.speedKmh) }],
    });
    graphFiles.push(speedGraph);
    const loadGraph = `${artifactDir}/acceleration-loads.svg`;
    writeLineChartSvg(loadGraph, {
      title: 'Acceleration tire normal loads', xLabel: 'time (s)', yLabel: 'Fz (N)',
      x: result.telemetry.map((s) => s.t),
      series: WHEEL_IDS.map((id, i) => ({ name: id, values: result.telemetry!.map((s) => s.wheels[i].fzN) })),
    });
    graphFiles.push(loadGraph);
  }

  if (result.id === 'braking' && result.telemetry?.length) {
    const graph = `${artifactDir}/braking-100kmh.svg`;
    writeLineChartSvg(graph, {
      title: '100–0 km/h braking', xLabel: 'time (s)', yLabel: 'value',
      x: result.telemetry.map((s) => s.t),
      series: [
        { name: 'speed km/h', values: result.telemetry.map((s) => s.speedKmh) },
        { name: 'decel g × 50', values: result.telemetry.map((s) => -s.longitudinalG * 50) },
      ],
    });
    graphFiles.push(graph);
  }

  if (result.id === 'skidpad') {
    const rows = (testSkidpad as any).sweepRows as any[] | undefined;
    if (rows?.length) {
      const sweepFile = `${artifactDir}/skidpad-sweep.csv`;
      writeRowsCsv(sweepFile, rows);
      const cd = rows.filter((r) => r.radius_m === 45.72).sort((a, b) => a.measured_lateral_g - b.measured_lateral_g);
      const graph = `${artifactDir}/skidpad-steering-vs-lateral-g.svg`;
      writeLineChartSvg(graph, {
        title: '45.72 m skidpad — steering demand vs lateral acceleration',
        subtitle: '45.72 m radius corresponds to C/D 300-ft diameter skidpad',
        xLabel: 'lateral acceleration (g)', yLabel: 'angle (deg)',
        x: cd.map((r) => r.measured_lateral_g),
        series: [
          { name: 'road-wheel steer', values: cd.map((r) => r.road_wheel_steer_deg) },
          { name: 'body roll', values: cd.map((r) => r.roll_deg) },
        ],
      });
      graphFiles.push(graph, sweepFile);
    }
  }

  if (result.id === 'step-steer' && result.telemetry?.length) {
    const graph = `${artifactDir}/step-steer-80kmh.svg`;
    writeLineChartSvg(graph, {
      title: '80 km/h step-steer chassis response',
      subtitle: 'Steer held 1.5 s then released; normal tire/suspension/chassis path',
      xLabel: 'time (s)', yLabel: 'scaled response', markerX: 1.5, markerLabel: 'steering release',
      x: result.telemetry.map((s) => s.t),
      series: [
        { name: 'yaw deg/s', values: result.telemetry.map((s) => s.yawRateRadS * RAD_TO_DEG) },
        { name: 'roll deg × 10', values: result.telemetry.map((s) => s.rollRad * RAD_TO_DEG * 10) },
        { name: 'lateral g × 30', values: result.telemetry.map((s) => s.lateralG * 30) },
      ],
    });
    graphFiles.push(graph);
  }

  if (result.id === 'bump-response' && result.telemetry?.length) {
    const graph = `${artifactDir}/bump-response.svg`;
    const y0 = result.telemetry[0].position.y;
    writeLineChartSvg(graph, {
      title: 'Single-front-wheel bump response',
      subtitle: 'Road excites wheel first; chassis heave should follow through suspension forces',
      xLabel: 'time (s)', yLabel: 'displacement (m)',
      x: result.telemetry.map((s) => s.t),
      series: [
        { name: 'FL suspension displacement', values: result.telemetry.map((s) => s.wheels[0].suspensionDisplacementM) },
        { name: 'chassis heave from start', values: result.telemetry.map((s) => s.position.y - y0) },
      ],
    });
    graphFiles.push(graph);
  }
  result.graphFiles = graphFiles;
}

function parseArg(name: string): string | null {
  const exact = process.argv.find((arg) => arg.startsWith(`--${name}=`));
  if (exact) return exact.slice(name.length + 3);
  const idx = process.argv.indexOf(`--${name}`);
  if (idx >= 0 && process.argv[idx + 1] && !process.argv[idx + 1].startsWith('--')) return process.argv[idx + 1];
  return null;
}

function main() {
  if (process.argv.includes('--list')) {
    console.log(Object.keys(TESTS).join('\n'));
    return;
  }

  const artifactDir = parseArg('artifacts') ?? 'artifacts/m5-validation';
  ensureArtifactDir(artifactDir);
  const requested = parseArg('test');
  const testIds = requested ? requested.split(',').map((s) => s.trim()).filter(Boolean) : Object.keys(TESTS);
  for (const id of testIds) {
    if (!TESTS[id]) throw new Error(`Unknown M5 validation test: ${id}. Use --list.`);
  }

  const results: ValidationResult[] = [];
  for (const id of testIds) {
    console.log(`\n[M5 validation] ${id}`);
    const result = TESTS[id]();
    writeResultArtifacts(result, artifactDir);
    results.push(result);
    console.log(`${result.status}: ${result.summary}`);
    for (const diagnostic of result.diagnostics) console.log(`  - ${diagnostic}`);
  }

  const statusCounts = results.reduce((acc: Record<string, number>, result) => {
    acc[result.status] = (acc[result.status] ?? 0) + 1;
    return acc;
  }, {});

  const report: any = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    vehicleConfiguration: '2025 BMW M5 G90 validation calibration',
    fixedDtSec: DT,
    fixedPhysicsHz: 1 / DT,
    coordinateContract: '+X left, +Y up, +Z forward; positive steer/yaw = left; wheel order FL/FR/RL/RR',
    antiGamingRule: 'All measurements use the normal Simulation/Vehicle path; validation code prescribes only driver inputs, road geometry/material and initial conditions.',
    statusCounts,
    results: results.map(({ telemetry, ...rest }) => rest),
    references: Object.values(M5_REFERENCE_DATA),
    referenceDataNeeded: M5_REFERENCE_DATA_NEEDED,
    placeholders: {
      abs: 'architecture present; dedicated straight/split-mu/cornering ABS validation to expand after controller identification',
      tractionControl: 'architecture present; launch and cornering traces already expose TCS activity',
      stabilityControl: 'REFERENCE SYSTEM NOT IMPLEMENTED — no fake ESC validation',
      tireTemperature: 'parameter plumbing present; no validated thermal model target yet',
      tirePressure: 'parameter plumbing present; no validated pressure sensitivity target yet',
      tireWear: 'parameter plumbing present; no validated degradation target yet',
      changingSurfaceConditions: 'ValidationSurfaceProvider supports friction, grade, wetness, split-mu and bump geometry',
    },
  };

  const baselinePath = parseArg('baseline');
  if (baselinePath && existsSync(baselinePath)) {
    const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));
    report.regressionDeltas = regressionDeltas(report, baseline);
  }

  const jsonPath = `${artifactDir}/m5-validation-report.json`;
  const markdownPath = `${artifactDir}/m5-validation-report.md`;
  writeJson(jsonPath, report);
  writeMarkdown(markdownPath, report);

  const summaryRows = results.flatMap((result) => Object.entries(result.metrics).map(([metric, value]) => ({
    test: result.id,
    status: result.status,
    validation_class: result.validationClass,
    metric,
    value,
  })));
  writeRowsCsv(`${artifactDir}/m5-validation-metrics.csv`, summaryRows);

  console.log('\n2025 BMW M5 Vehicle Dynamics Validation');
  console.log(`PASS ${statusCounts.PASS ?? 0} | WARNING ${statusCounts.WARNING ?? 0} | FAIL ${statusCounts.FAIL ?? 0} | NO REFERENCE DATA ${statusCounts['NO REFERENCE DATA'] ?? 0}`);
  console.log(`Report: ${jsonPath}`);
  console.log(`Markdown: ${markdownPath}`);

  const blockingFailure = results.some((result) => result.blocking && result.status === 'FAIL');
  const strictFailure = process.argv.includes('--strict') && results.some((result) => result.status === 'FAIL');
  if (blockingFailure || strictFailure) process.exitCode = 1;
}

main();

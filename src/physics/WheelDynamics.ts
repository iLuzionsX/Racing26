import { PhysicsMath } from './math/PhysicsMath';
import { TireModel, TireModelConfig, TireForceOutput } from './TireModel';

export interface GrossTireSlideEstimate {
  longitudinalSlipSpeed: number;
  lateralSlipSpeed: number;
  totalSlipSpeed: number;
}

/**
 * Estimate only the portion of contact-patch motion that represents gross
 * sliding across the road. Normal force-generating tire slip is mostly
 * carcass/contact-patch deformation and must not automatically create smoke.
 */
export function estimateGrossTireSlide(
  longitudinalVelocity: number,
  lateralVelocity: number,
  wheelSurfaceSpeed: number
): GrossTireSlideEstimate {
  const rollingSpeed = Math.max(Math.abs(longitudinalVelocity), Math.abs(wheelSurfaceSpeed));
  const longitudinalPatchSpeed = Math.abs(wheelSurfaceSpeed - longitudinalVelocity);
  const longitudinalAdhesionSpeed = Math.max(0.8, rollingSpeed * 0.15);
  const longitudinalSlipSpeed = Math.max(0, longitudinalPatchSpeed - longitudinalAdhesionSpeed);
  const lateralAdhesionSpeed = Math.max(
    0.45,
    Math.tan(0.22) * Math.max(0.5, Math.abs(longitudinalVelocity))
  );
  const lateralSlipSpeed = Math.max(0, Math.abs(lateralVelocity) - lateralAdhesionSpeed);
  return {
    longitudinalSlipSpeed,
    lateralSlipSpeed,
    totalSlipSpeed: Math.hypot(longitudinalSlipSpeed, lateralSlipSpeed),
  };
}

export interface WheelDynamicsConfig {
  id: string;
  isFront: boolean;
  isLeft: boolean;
  radius: number;
  inertia: number;
  tireConfig: TireModelConfig;
}

const makeZeroTireOutput = (): TireForceOutput => ({
  fx: 0,
  fy: 0,
  aligningTorque: 0,
  pneumaticTrail: 0,
  sidewallDeflection: 0,
  tireSquishM: 0,
  isSkidding: false,
  skidIntensity: 0,
  frictionLimit: 0,
  gripUtilization: 0,
  effectiveMu: 0,
});

const combinedEnvelopeUsage = (
  fx: number,
  fy: number,
  longitudinalLimit: number,
  lateralLimit: number,
  exponent: number
): number => {
  if (longitudinalLimit <= 1 || lateralLimit <= 1) return 0;
  const nx = Math.abs(fx) / longitudinalLimit;
  const ny = Math.abs(fy) / lateralLimit;
  return Math.pow(Math.pow(nx, exponent) + Math.pow(ny, exponent), 1 / exponent);
};

/**
 * One wheel rotational DOF + tire transient states.
 *
 * Raw geometric slip is deliberately NOT sent straight to the chassis. First
 * contact-patch slip relaxes over tire travel, then force itself relaxes over a
 * shorter carcass length. This turns an instantaneous steering command into a
 * short physical sequence: slip builds -> tire force builds -> chassis loads up.
 *
 * Below walking pace, the normal slip-angle/slip-ratio formulation is blended
 * into a small brush-model contact patch. That matters because geometric slip
 * becomes poorly conditioned as road speed approaches zero. A real stationary
 * tire stores a few millimetres of rubber shear before it slides; it does not
 * instantly produce a full dynamic tire force or smoke just because the steering
 * is at full lock.
 */
export class WheelDynamics {
  public readonly id: string;
  public readonly isFront: boolean;
  public readonly isLeft: boolean;
  public readonly radius: number;
  public readonly inertia: number;

  public steerAngle = 0;
  public rotationAngle = 0;
  public angularVelocity = 0;

  public rawSlipAngle = 0;
  public rawSlipRatio = 0;
  public relaxationSlipAngle = 0;
  public relaxationSlipRatio = 0;

  public temperature = 25;
  public pressurePsi: number;
  public wearPercent = 0;
  public brakeRotorTemp = 25;

  public lastTireOutput: TireForceOutput = makeZeroTireOutput();

  private tireModel: TireModel;
  private transientFx = 0;
  private transientFy = 0;
  private transientMz = 0;
  private lowSpeedLongDeflection = 0;
  private lowSpeedLatDeflection = 0;
  private previousSteerAngle = 0;

  constructor(config: WheelDynamicsConfig) {
    this.id = config.id;
    this.isFront = config.isFront;
    this.isLeft = config.isLeft;
    this.radius = Math.max(0.05, config.radius);
    this.inertia = Math.max(0.05, config.inertia);
    this.tireModel = new TireModel(config.tireConfig);
    this.pressurePsi = config.tireConfig.basePressurePsi;
  }

  public get tireConfig(): TireModelConfig {
    return this.tireModel.config;
  }

  public set tireConfig(config: TireModelConfig) {
    this.tireModel.config = { ...config };
    if (!Number.isFinite(this.pressurePsi)) this.pressurePsi = config.basePressurePsi;
  }

  public reset(forwardSpeed: number = 0) {
    this.steerAngle = 0;
    this.previousSteerAngle = 0;
    this.rotationAngle = 0;
    this.angularVelocity = forwardSpeed / this.radius;
    this.rawSlipAngle = 0;
    this.rawSlipRatio = 0;
    this.relaxationSlipAngle = 0;
    this.relaxationSlipRatio = 0;
    this.transientFx = 0;
    this.transientFy = 0;
    this.transientMz = 0;
    this.lowSpeedLongDeflection = 0;
    this.lowSpeedLatDeflection = 0;
    this.temperature = 25;
    this.pressurePsi = this.tireConfig.basePressurePsi;
    this.wearPercent = 0;
    this.brakeRotorTemp = 25;
    this.lastTireOutput = makeZeroTireOutput();
    this.tireModel.reset();
  }

  public update(
    longitudinalVelocity: number,
    lateralVelocity: number,
    verticalLoad: number,
    camberDeg: number,
    driveTorque: number,
    hydraulicBrakeTorque: number,
    handbrakeTorque: number,
    surfaceFriction: number,
    rollingResistance: number,
    dt: number,
    reflectedDrivelineInertia: number = 0
  ): TireForceOutput {
    if (dt <= 0) return this.lastTireOutput;

    const steerDelta = this.steerAngle - this.previousSteerAngle;
    if (Math.abs(steerDelta) > 1e-10) {
      const c = Math.cos(steerDelta);
      const s = Math.sin(steerDelta);
      const oldDefLong = this.lowSpeedLongDeflection;
      const oldDefLat = this.lowSpeedLatDeflection;
      this.lowSpeedLongDeflection = oldDefLong * c + oldDefLat * s;
      this.lowSpeedLatDeflection = -oldDefLong * s + oldDefLat * c;
      const oldFx = this.transientFx;
      const oldFy = this.transientFy;
      this.transientFx = oldFx * c + oldFy * s;
      this.transientFy = -oldFx * s + oldFy * c;
    }
    this.previousSteerAngle = this.steerAngle;

    const fz = Math.max(0, verticalLoad);
    const brakeRequest = Math.max(0, hydraulicBrakeTorque) + Math.max(0, handbrakeTorque);
    const roadOmega = longitudinalVelocity / this.radius;
    const isFreeRolling = Math.abs(driveTorque) < 8 && brakeRequest < 8 && fz > 20;

    const freeRollFullConstraintMs = 1.40;
    const freeRollDynamicMs = 3.40;
    const freeRollLinear = PhysicsMath.clamp(
      (freeRollDynamicMs - Math.abs(longitudinalVelocity)) /
        (freeRollDynamicMs - freeRollFullConstraintMs),
      0,
      1
    );
    const freeRollConstraintAuthority = isFreeRolling
      ? freeRollLinear * freeRollLinear * (3 - 2 * freeRollLinear)
      : 0;
    const freeRollDynamicAuthority = 1 - freeRollConstraintAuthority;

    if (isFreeRolling) {
      const baselineTrackingRate = Math.abs(longitudinalVelocity) < 5 ? 120 : 45;
      const trackingRate = PhysicsMath.lerp(
        baselineTrackingRate,
        220,
        freeRollConstraintAuthority
      );
      const trackingAlpha = 1 - Math.exp(-trackingRate * dt);
      this.angularVelocity += (roadOmega - this.angularVelocity) * trackingAlpha;
    }

    const wheelSurfaceSpeed = this.angularVelocity * this.radius;
    const rollingSpeed = Math.max(Math.abs(longitudinalVelocity), Math.abs(wheelSurfaceSpeed));
    const dynamicBlendLinear = PhysicsMath.clamp((rollingSpeed - 0.35) / (3.00 - 0.35), 0, 1);
    const dynamicBlend = dynamicBlendLinear * dynamicBlendLinear * (3 - 2 * dynamicBlendLinear);

    const contactRoadSpeed = Math.hypot(longitudinalVelocity, lateralVelocity);
    const configuredLateralSigma = Math.max(0.035, this.tireConfig.relaxationLength);
    const parkingLateralSigma = Math.min(configuredLateralSigma, 0.15);
    const lateralRoadSpeedLinear = PhysicsMath.clamp((contactRoadSpeed - 3.5) / (7.5 - 3.5), 0, 1);
    const lateralRoadSpeedBlend =
      lateralRoadSpeedLinear * lateralRoadSpeedLinear * (3 - 2 * lateralRoadSpeedLinear);
    const effectiveLateralSigma = PhysicsMath.lerp(
      parkingLateralSigma,
      configuredLateralSigma,
      lateralRoadSpeedBlend
    );

    const speedForSlip = Math.max(2.0, Math.abs(longitudinalVelocity), Math.abs(wheelSurfaceSpeed) * 0.35);
    const unconstrainedSlipRatio = PhysicsMath.clamp(
      (wheelSurfaceSpeed - longitudinalVelocity) / speedForSlip,
      -3,
      3
    );
    this.rawSlipRatio = unconstrainedSlipRatio * freeRollDynamicAuthority;

    const angleSpeedFloor = 0.9;
    this.rawSlipAngle = -Math.atan2(
      lateralVelocity,
      Math.max(angleSpeedFloor, Math.abs(longitudinalVelocity))
    );

    if (fz < 20) {
      const airborneDecay = Math.exp(-dt / 0.025);
      this.relaxationSlipAngle *= airborneDecay;
      this.relaxationSlipRatio *= airborneDecay;
      this.transientFx *= airborneDecay;
      this.transientFy *= airborneDecay;
      this.transientMz *= airborneDecay;
      this.lowSpeedLongDeflection *= airborneDecay;
      this.lowSpeedLatDeflection *= airborneDecay;
    } else {
      const lateralSigma = effectiveLateralSigma;
      const longitudinalSigma = Math.max(
        0.025,
        this.tireConfig.longitudinalRelaxationLength ?? this.tireConfig.relaxationLength
      );
      const relaxationTravel = Math.max(0.02, rollingSpeed) * dt;
      const lateralSlipAlpha = 1 - Math.exp(-relaxationTravel / lateralSigma);
      const longitudinalSlipAlpha = 1 - Math.exp(-relaxationTravel / longitudinalSigma);
      this.relaxationSlipAngle += (this.rawSlipAngle - this.relaxationSlipAngle) * lateralSlipAlpha;
      this.relaxationSlipRatio +=
        (this.rawSlipRatio - this.relaxationSlipRatio) * longitudinalSlipAlpha;
      if (freeRollConstraintAuthority > 0) {
        const constraintSlipDecay = Math.exp(-80 * freeRollConstraintAuthority * dt);
        this.relaxationSlipRatio *= constraintSlipDecay;
      }
    }

    const optimalTemp = this.tireConfig.optimalTemp;
    const tempError = Math.abs(this.temperature - optimalTemp);
    const thermalGrip = PhysicsMath.clamp(1.02 - tempError * 0.0018, 0.88, 1.02);
    const wearGrip = PhysicsMath.clamp(1 - this.wearPercent * 0.0022, 0.70, 1.0);

    const target = this.tireModel.calculate({
      slipRatio: this.relaxationSlipRatio,
      slipAngle: this.relaxationSlipAngle,
      verticalLoad: fz,
      camberDeg,
      surfaceFriction,
      gripScale: thermalGrip * wearGrip,
      isLeft: this.isLeft,
    });

    const longPatchSlipSpeed = wheelSurfaceSpeed - longitudinalVelocity;
    const latPatchSlipSpeed = -lateralVelocity;
    const staticWeight = 1 - dynamicBlend;

    if (fz >= 20) {
      const dynamicStateDecay = Math.exp(-18 * dynamicBlend * dt);
      this.lowSpeedLongDeflection *= dynamicStateDecay;
      this.lowSpeedLatDeflection *= dynamicStateDecay;
      const constraintBristleDecay = Math.exp(-90 * freeRollConstraintAuthority * dt);
      this.lowSpeedLongDeflection *= constraintBristleDecay;
      this.lowSpeedLongDeflection +=
        longPatchSlipSpeed * dt * staticWeight * freeRollDynamicAuthority;
      this.lowSpeedLatDeflection += latPatchSlipSpeed * dt * staticWeight;
    }

    const bristleStiffness = Math.max(140000, fz / 0.015);
    const effectiveCornerMass = Math.max(80, fz / 9.81);
    const criticalBristleDamping = 2 * Math.sqrt(bristleStiffness * effectiveCornerMass);
    const bristleDamping = PhysicsMath.clamp(criticalBristleDamping * 0.72, 8000, 32000);

    let staticFx =
      (this.lowSpeedLongDeflection * bristleStiffness + longPatchSlipSpeed * bristleDamping) *
      freeRollDynamicAuthority;
    let staticFy = this.lowSpeedLatDeflection * bristleStiffness + latPatchSlipSpeed * bristleDamping;
    const patchSlipSpeed = Math.hypot(longPatchSlipSpeed, lateralVelocity);

    const patchNearlySettled =
      fz >= 20 &&
      rollingSpeed < 0.55 &&
      patchSlipSpeed < 0.28 &&
      Math.abs(driveTorque) < 15 &&
      brakeRequest < 15;
    if (patchNearlySettled) {
      const creepDecay = Math.exp(-dt / 0.35);
      this.lowSpeedLongDeflection *= creepDecay;
      this.lowSpeedLatDeflection *= creepDecay;
    }

    const lowSpeedSlideBlend = PhysicsMath.clamp((patchSlipSpeed - 0.15) / 0.85, 0, 1);
    const lowSpeedMuMultiplier = PhysicsMath.lerp(
      1.08,
      PhysicsMath.clamp(this.tireConfig.slideFrictionMultiplier, 0.45, 1.0),
      lowSpeedSlideBlend
    );
    const lowSpeedFrictionLimit = Math.max(0, target.effectiveMu * fz * lowSpeedMuMultiplier);
    const staticResultant = Math.hypot(staticFx, staticFy);
    if (lowSpeedFrictionLimit > 0 && staticResultant > lowSpeedFrictionLimit) {
      const scale = lowSpeedFrictionLimit / staticResultant;
      staticFx *= scale;
      staticFy *= scale;
      this.lowSpeedLongDeflection *= scale;
      this.lowSpeedLatDeflection *= scale;
    }

    const blendedTargetFx = PhysicsMath.lerp(staticFx, target.fx, dynamicBlend);
    const blendedTargetFy = PhysicsMath.lerp(staticFy, target.fy, dynamicBlend);
    const blendedTargetMz = target.aligningTorque * dynamicBlend;
    const targetLongitudinalLimit = target.longitudinalForceLimit ?? target.frictionLimit;
    const targetLateralLimit = target.lateralForceLimit ?? target.frictionLimit;
    const blendedLongitudinalLimit = PhysicsMath.lerp(
      lowSpeedFrictionLimit,
      targetLongitudinalLimit,
      dynamicBlend
    );
    const blendedLateralLimit = PhysicsMath.lerp(
      lowSpeedFrictionLimit,
      targetLateralLimit,
      dynamicBlend
    );
    const blendedCombinedSlipExponent = PhysicsMath.lerp(
      2.0,
      target.combinedSlipExponent ?? 2.0,
      dynamicBlend
    );
    const blendedFrictionLimit = Math.max(blendedLongitudinalLimit, blendedLateralLimit);

    const lateralForceSigma = Math.max(0.025, effectiveLateralSigma * 0.55);
    const longitudinalForceSigma = Math.max(
      0.018,
      this.tireConfig.longitudinalForceRelaxationLength ??
        ((this.tireConfig.longitudinalRelaxationLength ?? this.tireConfig.relaxationLength) * 0.55)
    );
    const forceTravel = Math.max(0.02, rollingSpeed) * dt;
    const dynamicLateralForceAlpha = 1 - Math.exp(-forceTravel / lateralForceSigma);
    const dynamicLongitudinalForceAlpha = 1 - Math.exp(-forceTravel / longitudinalForceSigma);
    const lowSpeedForceAlpha = 1 - Math.exp(-110 * dt);
    const lateralForceAlpha = PhysicsMath.lerp(lowSpeedForceAlpha, dynamicLateralForceAlpha, dynamicBlend);
    const longitudinalForceAlpha = PhysicsMath.lerp(lowSpeedForceAlpha, dynamicLongitudinalForceAlpha, dynamicBlend);

    this.transientFx += (blendedTargetFx - this.transientFx) * longitudinalForceAlpha;
    if (freeRollConstraintAuthority > 0) {
      const constraintForceDecay = Math.exp(-70 * freeRollConstraintAuthority * dt);
      this.transientFx *= constraintForceDecay;
    }
    this.transientFy += (blendedTargetFy - this.transientFy) * lateralForceAlpha;
    this.transientMz += (blendedTargetMz - this.transientMz) * lateralForceAlpha;

    const rrMagnitude = Math.max(0, rollingResistance) * fz;
    const rrForce = -Math.tanh(longitudinalVelocity / 0.08) * rrMagnitude;
    let fx = this.transientFx + rrForce;
    let fy = this.transientFy;

    const limit = Math.max(0, blendedFrictionLimit);
    let transientEnvelopeUsage = combinedEnvelopeUsage(
      fx,
      fy,
      blendedLongitudinalLimit,
      blendedLateralLimit,
      blendedCombinedSlipExponent
    );
    if (transientEnvelopeUsage > 1) {
      const scale = 1 / transientEnvelopeUsage;
      fx *= scale;
      fy *= scale;
      this.transientFx *= scale;
      this.transientFy *= scale;
      transientEnvelopeUsage = 1;
    }

    const contactFxForWheelTorque = fx - rrForce;
    const spinReference = Math.abs(this.angularVelocity) > 0.35 ? this.angularVelocity : roadOmega;
    const brakeSign = Math.sign(spinReference);
    const tireReactionTorque = contactFxForWheelTorque * this.radius;
    const nonBrakeTorque = driveTorque - tireReactionTorque;
    const brakeCanHold = brakeRequest > Math.abs(nonBrakeTorque) + 2.0;
    const staticBrakeHold =
      brakeCanHold &&
      Math.abs(longitudinalVelocity) < 1.20 &&
      Math.abs(this.angularVelocity) < 4.5;

    if (staticBrakeHold) {
      this.angularVelocity = 0;
    } else {
      const brakeTorque = brakeRequest * brakeSign;
      const effectiveRotationalInertia = this.inertia + Math.max(0, reflectedDrivelineInertia);
      const angularAccel = PhysicsMath.clamp(
        (nonBrakeTorque - brakeTorque) / effectiveRotationalInertia,
        -4500,
        4500
      );
      const omegaBefore = this.angularVelocity;
      this.angularVelocity += angularAccel * dt;
      const beforeError = omegaBefore - roadOmega;
      const afterError = this.angularVelocity - roadOmega;

      if (Math.abs(driveTorque) < 20 && brakeRequest < 20 && beforeError * afterError < 0) {
        this.angularVelocity = roadOmega;
      }

      if (isFreeRolling && freeRollConstraintAuthority > 0) {
        const postTrackingRate = 180 * freeRollConstraintAuthority;
        const postTrackingAlpha = 1 - Math.exp(-postTrackingRate * dt);
        this.angularVelocity += (roadOmega - this.angularVelocity) * postTrackingAlpha;
      }

      if (
        brakeCanHold &&
        Math.abs(spinReference) > 1e-6 &&
        Math.sign(this.angularVelocity) !== Math.sign(spinReference)
      ) {
        this.angularVelocity = 0;
      }

      if (Math.abs(longitudinalVelocity) < 1.0 && Math.abs(driveTorque) < 15 && brakeRequest < 15) {
        const sync = 1 - Math.exp(-14 * dt);
        this.angularVelocity += (roadOmega - this.angularVelocity) * sync;
      }
    }

    const quiescentFreeRolling =
      fz >= 20 &&
      Math.abs(longitudinalVelocity) < 0.35 &&
      Math.abs(lateralVelocity) < 0.25 &&
      Math.abs(driveTorque) < 15 &&
      brakeRequest < 15;
    if (quiescentFreeRolling) {
      this.angularVelocity = roadOmega;
      const slipStateDecay = Math.exp(-dt / 0.10);
      this.rawSlipRatio *= slipStateDecay;
      this.relaxationSlipRatio *= slipStateDecay;
    }

    this.rotationAngle += this.angularVelocity * dt;
    if (Math.abs(this.rotationAngle) > Math.PI * 1000) this.rotationAngle %= Math.PI * 2;

    const slipEnergy = Math.abs(fx * longPatchSlipSpeed) + Math.abs(fy * lateralVelocity);
    const heatIn = slipEnergy * 0.00005;
    const cooling = (this.temperature - 25) * (0.020 + Math.abs(longitudinalVelocity) * 0.0025);
    this.temperature += (heatIn - cooling) * dt;
    this.temperature = PhysicsMath.clamp(this.temperature, 20, 180);
    this.pressurePsi = this.tireConfig.basePressurePsi + Math.max(0, this.temperature - 25) * 0.035;
    this.wearPercent = PhysicsMath.clamp(this.wearPercent + slipEnergy * 1.5e-9 * dt, 0, 100);

    const brakePower = brakeRequest * Math.abs(this.angularVelocity);
    this.brakeRotorTemp += (brakePower * 0.00022 - (this.brakeRotorTemp - 25) * 0.08) * dt;
    this.brakeRotorTemp = PhysicsMath.clamp(this.brakeRotorTemp, 20, 900);

    const gripUtilization = limit > 0 ? PhysicsMath.clamp(transientEnvelopeUsage, 0, 1.5) : 0;
    const grossSlide = estimateGrossTireSlide(
      longitudinalVelocity,
      lateralVelocity,
      wheelSurfaceSpeed
    );
    const grossSlipEnergy =
      Math.abs(contactFxForWheelTorque) * grossSlide.longitudinalSlipSpeed +
      Math.abs(fy) * grossSlide.lateralSlipSpeed;
    const skidSpeedGate = PhysicsMath.clamp((grossSlide.totalSlipSpeed - 0.35) / 2.4, 0, 1);
    const skidPowerGate = PhysicsMath.clamp((grossSlipEnergy - 1200) / 9000, 0, 1);
    const dissipativeSkidGate = Math.min(skidSpeedGate, skidPowerGate);
    const isDissipativeSkid = dissipativeSkidGate > 0;
    const skidIntensity = isDissipativeSkid
      ? PhysicsMath.clamp(
          Math.max(dissipativeSkidGate, target.skidIntensity * 0.35 * dynamicBlend) *
            dissipativeSkidGate,
          0,
          1
        )
      : 0;

    this.lastTireOutput = {
      ...target,
      fx,
      fy,
      aligningTorque: this.transientMz,
      frictionLimit: limit,
      gripUtilization,
      isSkidding: isDissipativeSkid,
      skidIntensity,
    };

    return this.lastTireOutput;
  }
}

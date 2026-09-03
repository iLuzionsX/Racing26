import { PhysicsMath } from './math/PhysicsMath';

export interface PowertrainConfig {
  maxTorque: number;
  idleRpm: number;
  maxRpm: number;
  revLimiterRpm: number;
  flywheelInertia: number;
  engineBrakingTorque: number;
  clutchBiteRate: number;
  maxClutchTorque?: number;
  transmissionEfficiency?: number;
  turboBoostMaxPsi: number;
  turboSpoolRate: number;
  wastegatePressurePsi: number;
  reverseRatio?: number;
  forwardGearRatios?: number[];
  gearRatios?: number[];
  finalDriveRatio: number;
  launchControlEnabled?: boolean;
  launchControlRpm?: number;
  lowSpeedTorqueFillNm?: number;
  torqueFillFadeRpm?: number;
  automaticTorqueConverter?: boolean;
  shiftDurationSec?: number;
  shiftTorqueMultiplier?: number;
  autoBlipDownshift: boolean;
}

export class Powertrain {
  public config: PowertrainConfig;
  public forwardGearRatios: number[];
  public reverseRatio: number;
  public finalDriveRatio: number;

  public engineRpm: number = 850;
  public flywheelRpm: number = 850;
  public gear: number = 1;
  public isAutomatic: boolean = false;
  public clutchPedal: number = 0;
  public clutchEngaged: boolean = true;
  public isRevLimiting: boolean = false;
  public revCutBounce: boolean = false;
  public turboBoostPsi: number = 0;
  public turboBlowOff: boolean = false;
  public wastegateOpen: boolean = false;
  public deliveredDriveshaftTorque: number = 0;
  public engineTorqueOutput: number = 0;
  public transmittedClutchTorque: number = 0;
  public converterSlipRadS: number = 0;
  public converterLowLoadAuthority: number = 0;
  public launchControlActive: boolean = false;

  private shiftTimer: number = 0;
  private autoBlipTimer: number = 0;
  private revCutTimer: number = 0;
  private clutchKickDurationTimer: number = 0;
  private prevThrottle: number = 0;

  constructor(config: PowertrainConfig) {
    this.config = { ...config };
    this.finalDriveRatio = config.finalDriveRatio || 3.45;
    this.reverseRatio = config.reverseRatio !== undefined ? config.reverseRatio : (config.gearRatios ? config.gearRatios[0] : -3.40);
    this.forwardGearRatios = config.forwardGearRatios || (config.gearRatios ? config.gearRatios.slice(1) : [3.82, 2.36, 1.68, 1.29, 1.00, 0.79]);
    this.engineRpm = config.idleRpm;
    this.flywheelRpm = config.idleRpm;
  }

  public reset() {
    this.engineRpm = this.config.idleRpm;
    this.flywheelRpm = this.config.idleRpm;
    this.gear = 1;
    this.clutchPedal = 0;
    this.clutchEngaged = true;
    this.isRevLimiting = false;
    this.revCutBounce = false;
    this.turboBoostPsi = 0;
    this.turboBlowOff = false;
    this.wastegateOpen = false;
    this.deliveredDriveshaftTorque = 0;
    this.engineTorqueOutput = 0;
    this.transmittedClutchTorque = 0;
    this.converterSlipRadS = 0;
    this.converterLowLoadAuthority = 0;
    this.launchControlActive = false;
    this.shiftTimer = 0;
    this.autoBlipTimer = 0;
    this.revCutTimer = 0;
    this.clutchKickDurationTimer = 0;
    this.prevThrottle = 0;
  }

  public triggerClutchKick() {
    this.clutchPedal = 1.0;
    this.clutchEngaged = false;
    this.clutchKickDurationTimer = 0.20;
  }

  private get shiftDuration(): number {
    return PhysicsMath.clamp(this.config.shiftDurationSec ?? 0.16, 0.025, 0.40);
  }

  public shiftUp() {
    const maxGears = this.forwardGearRatios.length;
    if (this.gear < maxGears && this.shiftTimer <= 0) {
      if (this.gear === -1) this.gear = 0;
      else this.gear++;
      this.shiftTimer = this.shiftDuration;
    }
  }

  public shiftDown() {
    if (this.gear > -1 && this.shiftTimer <= 0) {
      this.gear--;
      this.shiftTimer = this.shiftDuration;
      // A manual rev-match blip is a driver aid. In automatic mode the gearbox
      // controller must not turn a closed-throttle downshift into a real throttle
      // request at the wheels; doing so injects propulsion during corner entry.
      if (this.config.autoBlipDownshift && this.gear >= 1 && !this.isAutomatic) this.autoBlipTimer = 0.18;
    }
  }

  public getGearRatio(gear: number): number {
    if (gear === -1) return this.reverseRatio;
    if (gear === 0) return 0;
    const idx = gear - 1;
    if (idx >= 0 && idx < this.forwardGearRatios.length) return this.forwardGearRatios[idx];
    return 1.0;
  }

  private getLockedRpmForGear(drivenAxleAngularVelocity: number, gear: number): number {
    const ratio = Math.abs(this.getGearRatio(gear) * this.finalDriveRatio);
    return Math.abs(drivenAxleAngularVelocity) * ratio * 30 / Math.PI;
  }

  /**
   * Throttle-aware automatic shift schedule.
   *
   * Low throttle favors early, smooth upshifts; high throttle carries the engine
   * close to the limiter. Downshifts use a separate lower threshold to provide
   * hysteresis, and a predicted lower-gear RPM check prevents money-shift over-revs.
   */
  private updateAutomaticShiftSchedule(throttleInput: number, drivenAxleAngularVelocity: number) {
    if (!this.isAutomatic || this.shiftTimer > 0 || this.gear <= 0) return;

    const maxGears = this.forwardGearRatios.length;
    if (maxGears <= 0) return;

    const throttle = PhysicsMath.clamp(throttleInput, 0, 1);
    const throttleForUpshift = Math.pow(throttle, 1.5);
    const throttleForDownshift = Math.pow(throttle, 1.2);

    const lowLoadUpshiftRpm = this.config.idleRpm + 1500;
    const fullLoadUpshiftRpm = Math.max(lowLoadUpshiftRpm + 500, this.config.revLimiterRpm - 250);
    const upshiftRpm = PhysicsMath.lerp(lowLoadUpshiftRpm, fullLoadUpshiftRpm, throttleForUpshift);

    const coastDownshiftRpm = this.config.idleRpm + 350;
    const kickdownRpm = Math.min(this.config.revLimiterRpm - 900, this.config.idleRpm + 3100);
    const downshiftRpm = PhysicsMath.lerp(coastDownshiftRpm, kickdownRpm, throttleForDownshift);

    const lockedCurrentRpm = this.getLockedRpmForGear(drivenAxleAngularVelocity, this.gear);
    const effectiveCurrentRpm = Math.max(this.engineRpm, lockedCurrentRpm);

    if (this.gear < maxGears && effectiveCurrentRpm >= upshiftRpm) {
      this.shiftUp();
      return;
    }

    if (this.gear > 1 && this.engineRpm <= downshiftRpm) {
      const predictedLowerGearRpm = this.getLockedRpmForGear(drivenAxleAngularVelocity, this.gear - 1);
      const safeDownshiftRpm = this.config.revLimiterRpm - 250;
      if (predictedLowerGearRpm <= safeDownshiftRpm) {
        this.shiftDown();
      }
    }
  }

  public getRawEngineTorqueCurve(rpm: number): number {
    const normRpm = PhysicsMath.clamp(
      (rpm - this.config.idleRpm) / (this.config.maxRpm - this.config.idleRpm),
      0,
      1
    );
    let profile = 0;
    if (normRpm < 0.20) profile = 0.55 + 0.45 * (normRpm / 0.20);
    else if (normRpm <= 0.75) profile = 1.0;
    else profile = 1.0 - 0.25 * ((normRpm - 0.75) / 0.25);
    return this.config.maxTorque * profile;
  }

  public update(
    throttleInput: number,
    drivenAxleAngularVelocity: number,
    dt: number
  ): { engineTorque: number; driveshaftTorque: number; engineRpm: number } {
    if (this.shiftTimer > 0) this.shiftTimer -= dt;
    if (this.autoBlipTimer > 0) this.autoBlipTimer -= dt;
    if (this.clutchKickDurationTimer > 0) {
      this.clutchKickDurationTimer -= dt;
      if (this.clutchKickDurationTimer <= 0) this.clutchPedal = 0;
    }

    this.updateAutomaticShiftSchedule(throttleInput, drivenAxleAngularVelocity);

    let effectiveThrottle = throttleInput;
    if (this.autoBlipTimer > 0) effectiveThrottle = Math.max(effectiveThrottle, 0.75);
    if (this.shiftTimer > 0) {
      effectiveThrottle *= PhysicsMath.clamp(this.config.shiftTorqueMultiplier ?? 0.15, 0, 1);
    }

    if (effectiveThrottle > 0.3) {
      const spoolTarget = (effectiveThrottle * this.config.turboBoostMaxPsi * this.engineRpm) / this.config.maxRpm;
      this.turboBoostPsi += (spoolTarget - this.turboBoostPsi) * Math.min(1.0, this.config.turboSpoolRate * dt);
    } else {
      if (this.prevThrottle > 0.5 && effectiveThrottle < 0.2 && this.turboBoostPsi > 5.0) this.turboBlowOff = true;
      else this.turboBlowOff = false;
      this.turboBoostPsi = Math.max(0, this.turboBoostPsi - 22.0 * dt);
    }
    this.prevThrottle = effectiveThrottle;
    this.wastegateOpen = this.turboBoostPsi >= this.config.wastegatePressurePsi;

    const turboBoostMultiplier = 1.0 + (this.turboBoostPsi / Math.max(1, this.config.turboBoostMaxPsi)) * 0.45;

    if (this.engineRpm >= this.config.revLimiterRpm) {
      this.isRevLimiting = true;
      this.revCutTimer += dt;
      this.revCutBounce = Math.sin(this.revCutTimer * Math.PI * 60) > 0;
    } else {
      this.isRevLimiting = false;
      this.revCutBounce = false;
      this.revCutTimer = 0;
    }

    let rawTorque = this.getRawEngineTorqueCurve(this.engineRpm) * turboBoostMultiplier;
    const fillTorque = Math.max(0, this.config.lowSpeedTorqueFillNm || 0);
    const fillFadeRpm = Math.max(this.config.idleRpm + 200, this.config.torqueFillFadeRpm || 3200);
    const fillFraction = 1 - PhysicsMath.clamp(
      (this.engineRpm - this.config.idleRpm) / (fillFadeRpm - this.config.idleRpm),
      0,
      1
    );
    rawTorque += fillTorque * fillFraction;

    if (this.isRevLimiting && this.revCutBounce) rawTorque = 0;

    // Real engine torque does not switch discontinuously from pumping loss to
    // positive combustion at one accelerator sample. Keep the existing full-load
    // torque map untouched, but fade closed-throttle engine braking out smoothly
    // over the first 5% of pedal travel while combustion torque builds normally.
    const brakingFactor = this.engineRpm / this.config.maxRpm;
    const closedThrottleBrakingTorque = this.config.engineBrakingTorque * brakingFactor;
    const brakeReleaseLinear = PhysicsMath.clamp(effectiveThrottle / 0.05, 0, 1);
    const brakeRelease = brakeReleaseLinear * brakeReleaseLinear * (3 - 2 * brakeReleaseLinear);
    const engineCombustionTorque =
      rawTorque * effectiveThrottle - closedThrottleBrakingTorque * (1 - brakeRelease);
    this.engineTorqueOutput = engineCombustionTorque;

    const currentGearRatio = this.getGearRatio(this.gear);
    const finalDrive = this.finalDriveRatio;
    const totalGearRatio = currentGearRatio * finalDrive;
    const clutchPlateAngularVelocity = drivenAxleAngularVelocity * finalDrive * currentGearRatio;

    let omegaEngine = (this.engineRpm * Math.PI) / 30;
    let clutchCapacityFraction = 1.0 - this.clutchPedal;
    const hasAutomaticConverter = Boolean(this.isAutomatic && this.config.automaticTorqueConverter);

    if (this.gear === 0) {
      clutchCapacityFraction = 0;
    } else if (this.launchControlActive && this.config.launchControlEnabled && this.gear === 1) {
      clutchCapacityFraction = Math.min(clutchCapacityFraction, 0.08);
    } else if (hasAutomaticConverter && this.gear === 1) {
      const converterCoupling = PhysicsMath.clamp(
        0.42 + 0.58 * ((this.engineRpm - this.config.idleRpm) / 1800),
        0.42,
        1.0
      );
      clutchCapacityFraction = Math.min(clutchCapacityFraction, converterCoupling);
    } else if (this.gear === 1 && this.engineRpm < 1400) {
      const stallMargin = Math.max(0, (this.engineRpm - this.config.idleRpm) / (1400 - this.config.idleRpm));
      clutchCapacityFraction = Math.min(clutchCapacityFraction, stallMargin);
    }

    const baseClutchCapacity = this.config.maxClutchTorque || (this.config.maxTorque * 2.2);
    const maxClutchTorqueCapacity = baseClutchCapacity * clutchCapacityFraction;
    let transmittedClutchTorque = 0;
    this.converterSlipRadS = 0;
    this.converterLowLoadAuthority = 0;

    if (this.gear === 0 || clutchCapacityFraction < 0.05) {
      this.clutchEngaged = false;
      transmittedClutchTorque = 0;
    } else {
      const deltaOmega = omegaEngine - clutchPlateAngularVelocity;
      this.converterSlipRadS = deltaOmega;
      const clutchSlipTorque = deltaOmega * 95.0;

      // Legacy clutch-like coupling remains authoritative for manuals, higher
      // gears, launch control and meaningful accelerator demand. Smoothly release
      // the idle-creep cap with throttle so the converter has no second 2% cliff.
      let positiveTorqueCapacity = maxClutchTorqueCapacity;
      if (hasAutomaticConverter && this.gear === 1 && deltaOmega > 0) {
        const idleCreepTorque = PhysicsMath.clamp(this.config.maxTorque * 0.03, 12, 24);
        const creepReleaseLinear = PhysicsMath.clamp(effectiveThrottle / 0.08, 0, 1);
        const creepRelease = creepReleaseLinear * creepReleaseLinear * (3 - 2 * creepReleaseLinear);
        positiveTorqueCapacity = PhysicsMath.lerp(
          Math.min(maxClutchTorqueCapacity, idleCreepTorque),
          maxClutchTorqueCapacity,
          creepRelease
        );
      }
      const legacyTransmittedTorque = PhysicsMath.clamp(
        clutchSlipTorque,
        -maxClutchTorqueCapacity,
        positiveTorqueCapacity
      );

      if (hasAutomaticConverter && this.gear === 1 && !this.launchControlActive) {
        // A hydrodynamic torque converter is deliberately compliant near idle. It
        // cannot behave like a 95 Nm/(rad/s) bidirectional clutch and then borrow
        // hundreds of Nm from an engine whose idle speed is clamped. That old
        // formulation let a small 4–9% throttle input alternate the converter
        // between large drive and back-drive torque every 120 Hz frame, which
        // multiplied through first gear/final drive into multi-kNm wheel torque.
        //
        // Keep this correction state-based rather than steering-based: low engine
        // speed + low accelerator demand selects the fluid-coupling regime in any
        // maneuver. As either load or pump speed rises, authority fades smoothly
        // back to the calibrated high-load model.
        const throttleFullFluid = 0.10;
        const throttleLegacy = 0.24;
        const throttleLinear = PhysicsMath.clamp(
          (throttleLegacy - effectiveThrottle) / (throttleLegacy - throttleFullFluid),
          0,
          1
        );
        const throttleAuthority = throttleLinear * throttleLinear * (3 - 2 * throttleLinear);

        const fluidRpmStart = this.config.idleRpm + 650;
        const fluidRpmEnd = this.config.idleRpm + 1450;
        const rpmLinear = PhysicsMath.clamp(
          (fluidRpmEnd - this.engineRpm) / (fluidRpmEnd - fluidRpmStart),
          0,
          1
        );
        const rpmAuthority = rpmLinear * rpmLinear * (3 - 2 * rpmLinear);
        const lowLoadAuthority = throttleAuthority * rpmAuthority;
        this.converterLowLoadAuthority = lowLoadAuthority;

        if (lowLoadAuthority > 0) {
          const idleCreepTorque = PhysicsMath.clamp(this.config.maxTorque * 0.03, 12, 24);
          const availableDriveTorque = Math.max(0, engineCombustionTorque);
          const fluidPositiveCapacity = Math.min(
            maxClutchTorqueCapacity,
            idleCreepTorque + availableDriveTorque * 1.35
          );

          // Turbine-to-pump back-driving is weak with an unlocked converter near
          // idle. Bound it independently from drive torque; this represents fluid
          // drag/engine braking, not a rigid clutch suddenly applying 600+ Nm in
          // reverse when turbine speed passes pump speed by one integration step.
          const fluidBackdriveCapacity = Math.min(
            maxClutchTorqueCapacity,
            PhysicsMath.clamp(
              this.config.engineBrakingTorque * 0.75 + this.config.maxTorque * 0.03,
              30,
              120
            )
          );

          // A broad slip scale makes converter torque a soft hydrodynamic response
          // instead of a numerically stiff clutch. tanh also crosses zero smoothly.
          const fluidSlipScaleRadS = 35;
          const fluidTransmittedTorque = deltaOmega >= 0
            ? fluidPositiveCapacity * Math.tanh(deltaOmega / fluidSlipScaleRadS)
            : fluidBackdriveCapacity * Math.tanh(deltaOmega / fluidSlipScaleRadS);

          transmittedClutchTorque = PhysicsMath.lerp(
            legacyTransmittedTorque,
            fluidTransmittedTorque,
            lowLoadAuthority
          );
        } else {
          transmittedClutchTorque = legacyTransmittedTorque;
        }
      } else {
        transmittedClutchTorque = legacyTransmittedTorque;
      }

      this.clutchEngaged = Math.abs(deltaOmega) < 1.5;
    }

    this.transmittedClutchTorque = transmittedClutchTorque;

    const netFlywheelTorque = engineCombustionTorque - transmittedClutchTorque;
    const flywheelInertia = Math.max(0.08, this.config.flywheelInertia);
    omegaEngine += (netFlywheelTorque / flywheelInertia) * dt;

    if (this.launchControlActive && this.config.launchControlEnabled) {
      const launchTargetRpm = PhysicsMath.clamp(
        this.config.launchControlRpm || 3000,
        this.config.idleRpm,
        this.config.revLimiterRpm - 300
      );
      omegaEngine = (launchTargetRpm * Math.PI) / 30;
    }

    this.engineRpm = Math.max(this.config.idleRpm, (omegaEngine * 30) / Math.PI);
    this.flywheelRpm = this.engineRpm;
    if (this.engineRpm > this.config.maxRpm) {
      this.engineRpm = this.config.maxRpm;
      omegaEngine = (this.engineRpm * Math.PI) / 30;
    }

    const transmissionEfficiency = this.config.transmissionEfficiency || 0.95;
    this.deliveredDriveshaftTorque = transmittedClutchTorque * totalGearRatio * transmissionEfficiency;

    return {
      engineTorque: this.engineTorqueOutput,
      driveshaftTorque: this.deliveredDriveshaftTorque,
      engineRpm: this.engineRpm,
    };
  }
}

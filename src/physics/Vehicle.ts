import { VehicleConfig, VehicleState, WheelState, ControlInputs } from '../types';
import { Vec3, PhysicsMath } from './math/PhysicsMath';
import { RigidBody } from './RigidBody';
import { SuspensionSystem, SuspensionCornerConfig } from './Suspension';
import { WheelDynamics } from './WheelDynamics';
import { Powertrain } from './Powertrain';
import { DifferentialSystem } from './Differential';
import { BrakeSystem } from './Brakes';
import { DriverAidsSystem } from './DriverAids';
import { AerodynamicsSystem } from './Aero';
import { TelemetrySystem } from './Telemetry';
import { ISurfaceProvider, ProvingGroundSurfaceProvider } from './SurfaceProvider';
import {
  ChassisMassProperties,
  deriveChassisMassProperties,
} from './ChassisMassProperties';

export function projectTireShearOntoSurface(forceWorld: Vec3, surfaceNormal: Vec3): Vec3 {
  const normal = PhysicsMath.vec3Normalize(surfaceNormal);
  if (PhysicsMath.vec3Length(normal) < 1e-7) return forceWorld;
  const normalForce = PhysicsMath.vec3Dot(forceWorld, normal);
  return PhysicsMath.vec3Sub(forceWorld, PhysicsMath.vec3Scale(normal, normalForce));
}

export function wheelContactAuthorityForUprightness(uprightness: number): number {
  const fullAuthority = Math.cos(25 * Math.PI / 180);
  const zeroAuthority = Math.cos(60 * Math.PI / 180);
  const t = PhysicsMath.clamp((uprightness - zeroAuthority) / (fullAuthority - zeroAuthority), 0, 1);
  return t * t * (3 - 2 * t);
}

export class Vehicle {
  public config: VehicleConfig;
  public rigidBody: RigidBody;
  public chassisMassProperties: ChassisMassProperties;
  public suspension: SuspensionSystem;
  public wheels: [WheelDynamics, WheelDynamics, WheelDynamics, WheelDynamics];
  public powertrain: Powertrain;
  public differential: DifferentialSystem;
  public brakes: BrakeSystem;
  public driverAids: DriverAidsSystem;
  public aero: AerodynamicsSystem;
  public telemetry: TelemetrySystem;
  public surfaceProvider: ISurfaceProvider;

  // Visual / Debug Options
  public showForceVectors3D: boolean = true;
  private totalSimTime: number = 0;

  // Smoothing filters for G-forces
  private smoothedAx: number = 0;
  private smoothedAy: number = 0;
  private smoothedAz: number = 0;
  private exhaustFlameTimer: number = 0;

  constructor(config: VehicleConfig, surfaceProvider?: ISurfaceProvider) {
    this.config = { ...config };
    this.surfaceProvider = surfaceProvider || new ProvingGroundSurfaceProvider();

    // 1. Build a physical chassis mass model. The rigid-body origin is the actual
    // center of gravity, and the principal inertias are derived from mass second
    // moments rather than arbitrary per-axis multipliers.
    this.chassisMassProperties = deriveChassisMassProperties(this.config as any);
    const H = this.config.centerOfGravityHeight;

    this.rigidBody = new RigidBody(
      {
        mass: this.chassisMassProperties.mass,
        inertia: PhysicsMath.vec3Clone(this.chassisMassProperties.inertia),
        centerOfGravityHeight: H,
      },
      PhysicsMath.vec3(0, H, 0),
      0
    );

    this.suspension = new SuspensionSystem();

    // 2. Instantiate 4 Wheels [FL, FR, RL, RR]
    const tireRadius = this.config.wheelRadius;
    const wheelInertia = this.config.wheelInertia;

    const makeTireConfig = (isFront: boolean) => ({
      baseGrip: isFront ? this.config.tireGripFront : this.config.tireGripRear,
      stiffnessB: this.config.tireStiffness,
      longitudinalStiffnessB: (this.config as any).tireLongitudinalStiffnessB,
      lateralStiffnessB: (this.config as any).tireLateralStiffnessB,
      loadSensitivity: this.config.tireLoadSensitivity,
      slideFrictionMultiplier: this.config.slideFrictionMultiplier,
      relaxationLength: this.config.relaxationLength,
      longitudinalRelaxationLength: (this.config as any).longitudinalRelaxationLength,
      longitudinalForceRelaxationLength: (this.config as any).longitudinalForceRelaxationLength,
      pneumaticTrailMax: this.config.tirePneumaticTrailMax,
      camberStiffness: 85,
      optimalTemp: this.config.optimalTireTemp,
      basePressurePsi: this.config.tireBasePressure,
      referenceLoadN: isFront
        ? ((this.config as any).tireReferenceLoadFrontN ?? (this.config as any).tireReferenceLoadN)
        : ((this.config as any).tireReferenceLoadRearN ?? (this.config as any).tireReferenceLoadN),
      longitudinalGripScale: (this.config as any).tireLongitudinalGripScale,
      lateralGripScale: (this.config as any).tireLateralGripScale,
      longitudinalShapeC: (this.config as any).tireLongitudinalShapeC,
      lateralShapeC: (this.config as any).tireLateralShapeC,
      longitudinalCurvatureE: (this.config as any).tireLongitudinalCurvatureE,
      lateralCurvatureE: (this.config as any).tireLateralCurvatureE,
      combinedSlipLongitudinalB: (this.config as any).tireCombinedSlipLongitudinalB,
      combinedSlipLateralB: (this.config as any).tireCombinedSlipLateralB,
      combinedSlipExponent: (this.config as any).tireCombinedSlipExponent,
      sidewallStiffness: (this.config as any).tireSidewallStiffness,
      verticalStiffness: (this.config as any).tireVerticalStiffness,
    });

    const tireConfigFront = makeTireConfig(true);
    const tireConfigRear = makeTireConfig(false);

    this.wheels = [
      new WheelDynamics({ id: 'FL', isFront: true, isLeft: true, radius: tireRadius, inertia: wheelInertia, tireConfig: tireConfigFront }),
      new WheelDynamics({ id: 'FR', isFront: true, isLeft: false, radius: tireRadius, inertia: wheelInertia, tireConfig: tireConfigFront }),
      new WheelDynamics({ id: 'RL', isFront: false, isLeft: true, radius: tireRadius, inertia: wheelInertia, tireConfig: tireConfigRear }),
      new WheelDynamics({ id: 'RR', isFront: false, isLeft: false, radius: tireRadius, inertia: wheelInertia, tireConfig: tireConfigRear }),
    ];

    // 3. Powertrain
    this.powertrain = new Powertrain({
      maxTorque: this.config.maxTorque,
      idleRpm: this.config.idleRpm,
      maxRpm: this.config.maxRpm,
      revLimiterRpm: this.config.revLimiterRpm,
      flywheelInertia: this.config.flywheelInertia,
      engineBrakingTorque: this.config.engineBrakingTorque,
      clutchBiteRate: this.config.clutchBiteRate,
      turboBoostMaxPsi: this.config.turboBoostMaxPsi,
      turboSpoolRate: this.config.turboSpoolRate,
      wastegatePressurePsi: this.config.wastegatePressurePsi,
      reverseRatio: this.config.reverseRatio,
      forwardGearRatios: this.config.forwardGearRatios,
      gearRatios: this.config.gearRatios,
      finalDriveRatio: this.config.finalDriveRatio,
      maxClutchTorque: this.config.maxClutchTorque,
      transmissionEfficiency: this.config.transmissionEfficiency,
      launchControlEnabled: this.config.launchControlEnabled,
      launchControlRpm: (this.config as any).launchControlRpm,
      lowSpeedTorqueFillNm: (this.config as any).lowSpeedTorqueFillNm,
      torqueFillFadeRpm: (this.config as any).torqueFillFadeRpm,
      automaticTorqueConverter: (this.config as any).automaticTorqueConverter,
      shiftDurationSec: (this.config as any).shiftDurationSec,
      shiftTorqueMultiplier: (this.config as any).shiftTorqueMultiplier,
      autoBlipDownshift: this.config.autoBlipDownshift,
    });

    // 4. Differential
    this.differential = new DifferentialSystem({
      type: this.config.differentialType,
      frontType: (this.config as any).frontDifferentialType,
      rearType: (this.config as any).rearDifferentialType,
      powerRamp: this.config.diffPowerRamp,
      coastRamp: this.config.diffCoastRamp,
      preloadTorque: this.config.diffPreloadTorque,
      drivetrain: this.config.drivetrain,
      frontTorqueRatio: (this.config as any).centerFrontTorqueRatio,
    });

    // 5. Brakes
    this.brakes = new BrakeSystem({
      maxBrakeTorque: this.config.brakeForce,
      handbrakeTorque: this.config.handbrakeForce,
      frontBias: this.config.brakeBiasFront,
    });

    // 6. Driver Aids
    this.driverAids = new DriverAidsSystem({
      absMode: this.config.absMode,
      tcsMode: this.config.tcsMode,
      wheelbase: this.config.wheelbase,
      trackWidth: this.chassisMassProperties.frontTrack,
      ackermannRatio: this.config.ackermannRatio,
      maxSteerAngle: this.config.maxSteerAngle,
      steerSpeed: this.config.steerSpeed,
      steerSpeedReduction: this.config.steerSpeedReduction,
      tcsSportSlipThreshold: (this.config as any).tcsSportSlipThreshold,
      tcsFullSlipThreshold: (this.config as any).tcsFullSlipThreshold,
      tcsSportResponse: (this.config as any).tcsSportResponse,
      tcsFullResponse: (this.config as any).tcsFullResponse,
      tcsSportGain: (this.config as any).tcsSportGain,
      tcsFullGain: (this.config as any).tcsFullGain,
    });

    // 7. Aerodynamics
    this.aero = new AerodynamicsSystem({
      downforceFront100Kmh: this.config.aeroDownforceFront,
      downforceRear100Kmh: this.config.aeroDownforceRear,
      dragCoeff: this.config.aeroDragCoeff,
      copPitchSensitivity: this.config.aeroCopPitchSensitivity,
      groundEffectUnderbody: this.config.groundEffectUnderbody,
      groundEffectMaxDownforce: this.config.groundEffectMaxDownforce,
      diffuserStallHeight: this.config.aeroDiffuserStallHeight,
      drsEnabled: this.config.drsEnabled,
      drsDragReduction: this.config.drsDragReduction,
      drsDownforceReduction: this.config.drsDownforceReduction,
      airbrakeEnabled: this.config.airbrakeEnabled,
    });

    this.telemetry = new TelemetrySystem();
  }

  public setConfig(newConfig: VehicleConfig) {
    this.config = { ...newConfig };
    this.chassisMassProperties = deriveChassisMassProperties(this.config as any);
    this.rigidBody.config = {
      mass: this.chassisMassProperties.mass,
      inertia: PhysicsMath.vec3Clone(this.chassisMassProperties.inertia),
      centerOfGravityHeight: newConfig.centerOfGravityHeight,
    };

    this.powertrain.config = {
      maxTorque: newConfig.maxTorque,
      idleRpm: newConfig.idleRpm,
      maxRpm: newConfig.maxRpm,
      revLimiterRpm: newConfig.revLimiterRpm,
      flywheelInertia: newConfig.flywheelInertia,
      engineBrakingTorque: newConfig.engineBrakingTorque,
      clutchBiteRate: newConfig.clutchBiteRate,
      turboBoostMaxPsi: newConfig.turboBoostMaxPsi,
      turboSpoolRate: newConfig.turboSpoolRate,
      wastegatePressurePsi: newConfig.wastegatePressurePsi,
      reverseRatio: newConfig.reverseRatio,
      forwardGearRatios: newConfig.forwardGearRatios,
      gearRatios: newConfig.gearRatios,
      finalDriveRatio: newConfig.finalDriveRatio,
      maxClutchTorque: newConfig.maxClutchTorque,
      transmissionEfficiency: newConfig.transmissionEfficiency,
      launchControlEnabled: newConfig.launchControlEnabled,
      launchControlRpm: (newConfig as any).launchControlRpm,
      lowSpeedTorqueFillNm: (newConfig as any).lowSpeedTorqueFillNm,
      torqueFillFadeRpm: (newConfig as any).torqueFillFadeRpm,
      automaticTorqueConverter: (newConfig as any).automaticTorqueConverter,
      shiftDurationSec: (newConfig as any).shiftDurationSec,
      shiftTorqueMultiplier: (newConfig as any).shiftTorqueMultiplier,
      autoBlipDownshift: newConfig.autoBlipDownshift,
    };
    this.powertrain.forwardGearRatios = [...newConfig.forwardGearRatios];
    this.powertrain.reverseRatio = newConfig.reverseRatio;
    this.powertrain.finalDriveRatio = newConfig.finalDriveRatio;

    this.differential.config = {
      type: newConfig.differentialType,
      frontType: (newConfig as any).frontDifferentialType,
      rearType: (newConfig as any).rearDifferentialType,
      powerRamp: newConfig.diffPowerRamp,
      coastRamp: newConfig.diffCoastRamp,
      preloadTorque: newConfig.diffPreloadTorque,
      drivetrain: newConfig.drivetrain,
      frontTorqueRatio: (newConfig as any).centerFrontTorqueRatio,
    };
    this.brakes.config = {
      maxBrakeTorque: newConfig.brakeForce,
      handbrakeTorque: newConfig.handbrakeForce,
      frontBias: newConfig.brakeBiasFront,
    };
    this.driverAids.config = {
      absMode: newConfig.absMode,
      tcsMode: newConfig.tcsMode,
      wheelbase: newConfig.wheelbase,
      trackWidth: this.chassisMassProperties.frontTrack,
      ackermannRatio: newConfig.ackermannRatio,
      maxSteerAngle: newConfig.maxSteerAngle,
      steerSpeed: newConfig.steerSpeed,
      steerSpeedReduction: newConfig.steerSpeedReduction,
      tcsSportSlipThreshold: (newConfig as any).tcsSportSlipThreshold,
      tcsFullSlipThreshold: (newConfig as any).tcsFullSlipThreshold,
      tcsSportResponse: (newConfig as any).tcsSportResponse,
      tcsFullResponse: (newConfig as any).tcsFullResponse,
      tcsSportGain: (newConfig as any).tcsSportGain,
      tcsFullGain: (newConfig as any).tcsFullGain,
    };
    this.aero.config = {
      downforceFront100Kmh: newConfig.aeroDownforceFront,
      downforceRear100Kmh: newConfig.aeroDownforceRear,
      dragCoeff: newConfig.aeroDragCoeff,
      copPitchSensitivity: newConfig.aeroCopPitchSensitivity,
      groundEffectUnderbody: newConfig.groundEffectUnderbody,
      groundEffectMaxDownforce: newConfig.groundEffectMaxDownforce,
      diffuserStallHeight: newConfig.aeroDiffuserStallHeight,
      drsEnabled: newConfig.drsEnabled,
      drsDragReduction: newConfig.drsDragReduction,
      drsDownforceReduction: newConfig.drsDownforceReduction,
      airbrakeEnabled: newConfig.airbrakeEnabled,
    };

    // Update wheel tire configs
    for (let i = 0; i < 4; i++) {
      const isFront = i < 2;
      (this.wheels[i] as any).radius = newConfig.wheelRadius;
      (this.wheels[i] as any).inertia = newConfig.wheelInertia;
      this.wheels[i].tireConfig = {
        baseGrip: isFront ? newConfig.tireGripFront : newConfig.tireGripRear,
        stiffnessB: newConfig.tireStiffness,
        longitudinalStiffnessB: (newConfig as any).tireLongitudinalStiffnessB,
        lateralStiffnessB: (newConfig as any).tireLateralStiffnessB,
        loadSensitivity: newConfig.tireLoadSensitivity,
        slideFrictionMultiplier: newConfig.slideFrictionMultiplier,
        relaxationLength: newConfig.relaxationLength,
        longitudinalRelaxationLength: (newConfig as any).longitudinalRelaxationLength,
        longitudinalForceRelaxationLength: (newConfig as any).longitudinalForceRelaxationLength,
        pneumaticTrailMax: newConfig.tirePneumaticTrailMax,
        camberStiffness: 85,
        optimalTemp: newConfig.optimalTireTemp,
        basePressurePsi: newConfig.tireBasePressure,
        referenceLoadN: isFront
          ? ((newConfig as any).tireReferenceLoadFrontN ?? (newConfig as any).tireReferenceLoadN)
          : ((newConfig as any).tireReferenceLoadRearN ?? (newConfig as any).tireReferenceLoadN),
        longitudinalGripScale: (newConfig as any).tireLongitudinalGripScale,
        lateralGripScale: (newConfig as any).tireLateralGripScale,
        longitudinalShapeC: (newConfig as any).tireLongitudinalShapeC,
        lateralShapeC: (newConfig as any).tireLateralShapeC,
        longitudinalCurvatureE: (newConfig as any).tireLongitudinalCurvatureE,
        lateralCurvatureE: (newConfig as any).tireLateralCurvatureE,
        combinedSlipLongitudinalB: (newConfig as any).tireCombinedSlipLongitudinalB,
        combinedSlipLateralB: (newConfig as any).tireCombinedSlipLateralB,
        combinedSlipExponent: (newConfig as any).tireCombinedSlipExponent,
        sidewallStiffness: (newConfig as any).tireSidewallStiffness,
        verticalStiffness: (newConfig as any).tireVerticalStiffness,
      };
    }
  }

  public reset(x: number = 0, z: number = 0, yaw: number = 0) {
    const H = this.config.centerOfGravityHeight;
    // RigidBody.position is the physical center of gravity, not a visual or
    // suspension reference point.
    this.rigidBody.position = PhysicsMath.vec3(x, H, z);
    this.rigidBody.velocity = PhysicsMath.vec3(0, 0, 0);
    this.rigidBody.angularVelocity = PhysicsMath.vec3(0, 0, 0);
    this.rigidBody.orientation = PhysicsMath.quatFromEuler(0, yaw, 0);
    this.rigidBody.clearForces();

    this.wheels.forEach((w) => w.reset(0));
    this.powertrain.reset();
    this.driverAids.reset();
    this.telemetry.reset();
    this.totalSimTime = 0;
    this.smoothedAx = 0;
    this.smoothedAy = 0;
    this.smoothedAz = 0;
    this.exhaustFlameTimer = 0;
  }

  public triggerClutchKick() {
    this.powertrain.triggerClutchKick();
  }

  public toggleDrs() {
    this.aero.toggleDrs();
  }

  /**
   * Get 4 suspension top-mount hardpoints relative to the physical CG.
   */
  public getHardpointsBody(): [Vec3, Vec3, Vec3, Vec3] {
    const frontHalfTrack = this.chassisMassProperties.frontTrack * 0.5;
    const rearHalfTrack = this.chassisMassProperties.rearTrack * 0.5;
    const frontDist = this.chassisMassProperties.cgToFrontAxle;
    const rearDist = this.chassisMassProperties.cgToRearAxle;
    // The former rigid-body origin was this pickup plane, 0.35 m above the CG.
    // Keep the physical top-mount height while expressing it correctly about the CG.
    const pickupHeightAboveCg = Math.max(
      0,
      Number((this.config as any).suspensionPickupHeightAboveCg ?? 0.35)
    );

    // +X is vehicle-left in the right-handed (+X left, +Y up, +Z forward) body frame.
    return [
      PhysicsMath.vec3(frontHalfTrack, pickupHeightAboveCg, frontDist),  // FL
      PhysicsMath.vec3(-frontHalfTrack, pickupHeightAboveCg, frontDist), // FR
      PhysicsMath.vec3(rearHalfTrack, pickupHeightAboveCg, -rearDist),  // RL
      PhysicsMath.vec3(-rearHalfTrack, pickupHeightAboveCg, -rearDist), // RR
    ];
  }

  /**
   * Step the entire 14-DOF vehicle simulation for fixed step dt
   */
  public step(inputs: ControlInputs, dt: number) {
    if (dt <= 0) return;
    this.totalSimTime += dt;

    // Shift handling
    if (inputs.shiftUp) this.powertrain.shiftUp();
    if (inputs.shiftDown) this.powertrain.shiftDown();

    const localVel = this.rigidBody.getLocalVelocity();
    const localW = this.rigidBody.getLocalAngularVelocity();
    const euler = this.rigidBody.getEuler();
    const forwardSpeed = localVel.z;
    const speedMs = PhysicsMath.vec3Length(this.rigidBody.velocity);

    // 1. Steering kinematics with Ackermann geometry
    const steerOut = this.driverAids.updateSteering(inputs.steer, forwardSpeed, dt);
    this.wheels[0].steerAngle = steerOut.steerFL;
    this.wheels[1].steerAngle = steerOut.steerFR;
    const meanFrontSteer = (steerOut.steerFL + steerOut.steerFR) * 0.5;
    const rearMax = (((this.config as any).rearSteerMaxDeg ?? 0) * Math.PI) / 180;
    const rearTransition = Math.max(1, (this.config as any).rearSteerTransitionSpeedMs ?? 20);
    const speedAbs = Math.abs(forwardSpeed);
    const phase = PhysicsMath.clamp((speedAbs - (rearTransition - 5)) / 10, 0, 1);
    const lowSpeedRear = -Math.sign(meanFrontSteer) * Math.min(Math.abs(meanFrontSteer) * 0.35, rearMax);
    const highSpeedRear = Math.sign(meanFrontSteer) * Math.min(Math.abs(meanFrontSteer) * 0.18, rearMax);
    const rearSteer = lowSpeedRear + (highSpeedRear - lowSpeedRear) * phase;
    this.wheels[2].steerAngle = rearSteer;
    this.wheels[3].steerAngle = rearSteer;

    // 2. Suspension ground clearance & solve 4-corner displacements and normal loads
    const hardpointsBody = this.getHardpointsBody();

    const cornerCfgFront: SuspensionCornerConfig = {
      restLength: this.config.suspensionRestLength,
      springStiffness: this.config.suspensionStiffness * 1.05,
      dampingLowSpeed: this.config.suspensionDampingLowSpeed,
      dampingHighSpeed: this.config.suspensionDampingHighSpeed,
      dampingRebound: this.config.suspensionReboundDamping,
      bumpStopStiffness: this.config.bumpStopStiffness,
      bumpStopThreshold: this.config.bumpStopTravelThreshold,
      maxDroop: 0.12,
      maxBump: 0.14,
      staticCamberDeg: this.config.camberStaticFront,
      camberGainDegPerMeter: this.config.camberGain,
      antiDiveSquatRatio: this.config.antiDiveFront,
    };

    const cornerCfgRear: SuspensionCornerConfig = {
      restLength: this.config.suspensionRestLength,
      springStiffness: this.config.suspensionStiffness * 0.95,
      dampingLowSpeed: this.config.suspensionDampingLowSpeed,
      dampingHighSpeed: this.config.suspensionDampingHighSpeed,
      dampingRebound: this.config.suspensionReboundDamping,
      bumpStopStiffness: this.config.bumpStopStiffness,
      bumpStopThreshold: this.config.bumpStopTravelThreshold,
      maxDroop: 0.12,
      maxBump: 0.14,
      staticCamberDeg: this.config.camberStaticRear,
      camberGainDegPerMeter: this.config.camberGain,
      antiDiveSquatRatio: this.config.antiSquatRear,
    };

    this.suspension.update(
      hardpointsBody,
      this.rigidBody.position,
      this.rigidBody.orientation,
      this.rigidBody.velocity,
      this.rigidBody.angularVelocity,
      (x, z) => this.surfaceProvider.sampleSurface(x, z),
      [cornerCfgFront, cornerCfgFront, cornerCfgRear, cornerCfgRear],
      this.config.rollStiffnessFront,
      this.config.rollStiffnessRear,
      this.config.antiRollCrossCoupling,
      this.config.wheelRadius,
      this.config.tireVerticalStiffness,
      dt
    );

    // 3. Aerodynamics (Front & Rear Downforce, Drag, Diffuser Suction)
    const minRideHeight = Math.min(...this.suspension.states.map((s) => this.config.suspensionRestLength - s.displacement));
    const aeroOut = this.aero.calculateAeroForces(
      localVel,
      euler.pitch,
      minRideHeight,
      inputs.brake,
      this.config.wheelbase
    );

    // Apply aero forces to rigid body
    this.rigidBody.addBodyForceAtPoint(aeroOut.frontAeroForce, aeroOut.frontPointBody);
    this.rigidBody.addBodyForceAtPoint(aeroOut.rearAeroForce, aeroOut.rearPointBody);
    this.rigidBody.addBodyForceAtPoint(aeroOut.diffuserAeroForce, aeroOut.diffuserPointBody);
    this.rigidBody.addBodyForceAtPoint(aeroOut.dragForce, PhysicsMath.vec3(0, 0, 0));

    // 4. TCS Throttle Reduction
    const drivenSlips =
      this.config.drivetrain === 'FWD'
        ? [this.wheels[0].rawSlipRatio, this.wheels[1].rawSlipRatio]
        : this.config.drivetrain === 'RWD'
        ? [this.wheels[2].rawSlipRatio, this.wheels[3].rawSlipRatio]
        : this.wheels.map((w) => w.rawSlipRatio);

    const tcsResult = this.driverAids.updateTCS(drivenSlips, dt);
    const effectiveThrottle = inputs.throttle * tcsResult.throttleMultiplier;

    // 5. Powertrain & Differential Torque Path
    const wheelOmegas: [number, number, number, number] = [
      this.wheels[0].angularVelocity,
      this.wheels[1].angularVelocity,
      this.wheels[2].angularVelocity,
      this.wheels[3].angularVelocity,
    ];

    // Driven axle speed
    const drivenOmega =
      this.config.drivetrain === 'FWD'
        ? (wheelOmegas[0] + wheelOmegas[1]) * 0.5
        : (wheelOmegas[2] + wheelOmegas[3]) * 0.5;

    // The G90 M5 can preload its automatic/hybrid powertrain against the brake.
    // Keep this physical state in the powertrain rather than faking extra launch force.
    this.powertrain.launchControlActive = Boolean(
      this.config.launchControlEnabled && inputs.brake > 0.55 && inputs.throttle > 0.80 && speedMs < 2.0
    );
    const powertrainOut = this.powertrain.update(effectiveThrottle, drivenOmega, dt);

    const diffOut = this.differential.distributeTorque(powertrainOut.driveshaftTorque, wheelOmegas);

    // 6. Brakes & ABS Controller
    const wheelSlips: [number, number, number, number] = [
      this.wheels[0].rawSlipRatio,
      this.wheels[1].rawSlipRatio,
      this.wheels[2].rawSlipRatio,
      this.wheels[3].rawSlipRatio,
    ];

    const absModulators = this.driverAids.updateABS(
      wheelSlips,
      wheelOmegas,
      speedMs,
      inputs.brake > 0.05,
      dt
    );
    this.brakes.pressureModulators = absModulators;

    const brakeTorques = this.brakes.calculateBrakeTorques(inputs.brake, inputs.handbrake);

    const currentGear = this.powertrain.gear;
    const currentGearRatio = currentGear > 0
      ? Math.abs(this.config.forwardGearRatios[currentGear - 1] ?? this.config.gearRatios[currentGear] ?? 0)
      : 0;
    const totalRatio = currentGearRatio * Math.abs(this.config.finalDriveRatio);
    const drivenWheelCount = this.config.drivetrain === 'AWD' ? 4 : 2;
    const drivelineInputInertia = Math.max(
      0,
      (this.config as any).drivelineInputInertia ?? this.config.flywheelInertia
    );
    const drivelineCoupling = PhysicsMath.clamp(
      (this.config as any).drivelineInertiaCoupling ?? 0.75,
      0,
      1.5
    );
    const reflectedDrivelineInertiaPerDrivenWheel =
      drivenWheelCount > 0
        ? (drivelineInputInertia * totalRatio * totalRatio * drivelineCoupling) / drivenWheelCount
        : 0;

    // 7. Solve 4 Wheels & Apply Contact Forces to Rigid Body
    let totalAligningTorque = 0;

    for (let i = 0; i < 4; i++) {
      const wheel = this.wheels[i];
      const suspState = this.suspension.states[i];
      const hpBody = hardpointsBody[i];

      // The tire shear force is still applied at the real road contact patch below,
      // preserving the CG-height pitch moment and longitudinal load transfer. For tire
      // rolling kinematics we normally use that same contact-point velocity. The one
      // exception is a brake-held wheel near rest: this suspension model constrains
      // the wheel center in X/Z while allowing its vertical coordinate to move. The
      // correct rolling-speed proxy in that regime is therefore the rigid-body point
      // coincident with the actual hub center, not the top mount and not a fictitious
      // point fixed at road height. Lateral slip keeps the established contact-patch
      // kinematics. This targets only the measured near-zero pitch-rebound artifact.
      const contactWorld = suspState.contactPointWorld;

      // Tire slip must be evaluated at the exact same world-space contact patch
      // where the resulting shear force is applied. The old shortcut used a fixed
      // body-space point (mount X/Z and -CG height). Once the chassis rolled or
      // pitched, that shortcut no longer transformed back to contactWorld, so the
      // tire saw the velocity of one lever arm while its force acted through
      // another. The mismatch is turn-dependent and can inject a false yaw moment
      // precisely when suspension load transfer is largest.
      const contactArmWorld = PhysicsMath.vec3Sub(contactWorld, this.rigidBody.position);
      const contactPointBody = PhysicsMath.quatInverseRotateVec3(
        this.rigidBody.orientation,
        contactArmWorld
      );
      const hubWorld = PhysicsMath.vec3(
        contactWorld.x,
        suspState.hubPositionWorldY,
        contactWorld.z
      );
      const hubArmWorld = PhysicsMath.vec3Sub(hubWorld, this.rigidBody.position);
      const hubPointBody = PhysicsMath.quatInverseRotateVec3(this.rigidBody.orientation, hubArmWorld);
      const vContactBody = this.rigidBody.getPointVelocityBody(contactPointBody);
      const vHubBody = this.rigidBody.getPointVelocityBody(hubPointBody);

      // Rotate velocity into wheel heading coordinate frame (steer angle about Y)
      const steer = wheel.steerAngle;
      const cosS = Math.cos(steer);
      const sinS = Math.sin(steer);
      const vxContact = vContactBody.x * sinS + vContactBody.z * cosS;
      const vxHub = vHubBody.x * sinS + vHubBody.z * cosS;
      const vyWheel = vContactBody.x * cosS - vContactBody.z * sinS;
      const hydraulicBrakeTorque = brakeTorques.hydraulicTorques[i];
      const handbrakeTorque = brakeTorques.handbrakeTorques[i];
      const brakeRequest = Math.max(0, hydraulicBrakeTorque) + Math.max(0, handbrakeTorque);
      const brakeHeldNearStop =
        brakeRequest > 20 &&
        Math.abs(wheel.angularVelocity) < 4.5 &&
        Math.max(Math.abs(vxContact), Math.abs(vxHub)) < 1.20;
      const vxWheel = brakeHeldNearStop ? vxHub : vxContact;

      // Sample local surface friction and properties
      const surface = this.surfaceProvider.sampleSurface(contactWorld.x, contactWorld.z);

      // Step wheel rotational dynamics and compute tire forces (Fx, Fy)
      const tireOut = wheel.update(
        vxWheel,
        vyWheel,
        suspState.tireNormalForceN,
        suspState.dynamicCamberDeg,
        diffOut.wheelTorques[i],
        hydraulicBrakeTorque,
        handbrakeTorque,
        surface.friction * this.config.ambientSurfaceFrictionMultiplier,
        surface.rollingResistance,
        dt,
        (() => {
          const isDriven =
            this.config.drivetrain === 'AWD' ||
            (this.config.drivetrain === 'FWD' && i < 2) ||
            (this.config.drivetrain === 'RWD' && i >= 2);
          return isDriven ? reflectedDrivelineInertiaPerDrivenWheel : 0;
        })()
      );

      totalAligningTorque += tireOut.aligningTorque;

      const roadNormal = PhysicsMath.vec3Normalize(surface.normal);
      const bodyUpWorld = PhysicsMath.quatRotateVec3(
        this.rigidBody.orientation,
        PhysicsMath.vec3(0, 1, 0)
      );
      const contactUprightness = PhysicsMath.vec3Dot(bodyUpWorld, roadNormal);
      const wheelContactAuthority = wheelContactAuthorityForUprightness(contactUprightness);

      // Spring, damper, bump-stop and ARB forces are internal suspension reactions,
      // so they remain connected to the chassis even when the tire unloads over a
      // crest. Do not gate them with tire contact authority or an airborne flag.
      const suspensionReactionWorld = PhysicsMath.vec3(0, suspState.chassisForceN, 0);
      const suspensionHardpointWorld = PhysicsMath.vec3Add(
        this.rigidBody.position,
        PhysicsMath.quatRotateVec3(this.rigidBody.orientation, hpBody)
      );
      this.rigidBody.addWorldForceAtPoint(suspensionReactionWorld, suspensionHardpointWorld);

      if (!suspState.isAirborne && suspState.tireNormalForceN > 0 && wheelContactAuthority > 0.001) {
        const fxBody = tireOut.fy * cosS + tireOut.fx * sinS;
        const fzBody = -tireOut.fy * sinS + tireOut.fx * cosS;
        const rawTireShearWorld = PhysicsMath.quatRotateVec3(
          this.rigidBody.orientation,
          PhysicsMath.vec3(fxBody, 0, fzBody)
        );
        const tirePlanarWorld = PhysicsMath.vec3Scale(
          projectTireShearOntoSurface(rawTireShearWorld, roadNormal),
          wheelContactAuthority
        );

        // Tire normal load excites only the independent wheel/hub mass and remains
        // the tire model's grip input. The sprung chassis receives road vertical load
        // through the suspension reaction above; planar tire shear remains external
        // at the road contact patch.
        this.rigidBody.addWorldForceAtPoint(tirePlanarWorld, contactWorld);
        this.rigidBody.addBodyTorque(
          PhysicsMath.vec3(0, tireOut.aligningTorque * wheelContactAuthority, 0)
        );
      }
    }

    // 8. Apply gravity only to the sprung heave generalized mass. The four unsprung
    // vertical masses receive their own gravity inside SuspensionSystem, so the full
    // static tire load still sums to the complete vehicle curb weight.
    const gravityForceWorld = PhysicsMath.vec3(0, -this.rigidBody.verticalMass * 9.81, 0);
    this.rigidBody.addWorldForce(gravityForceWorld);

    // 9. Integrate 6-DOF Rigid Body Equations of Motion
    this.rigidBody.integrate(dt);

    // 10. Update Telemetry, Performance Timers & G-Forces
    const rawAx = this.rigidBody.acceleration.x / 9.81;
    const rawAy = this.rigidBody.acceleration.y / 9.81;
    const rawAz = this.rigidBody.acceleration.z / 9.81;

    // Smooth G-forces
    const gAlpha = Math.min(1.0, 15.0 * dt);
    this.smoothedAx += (rawAx - this.smoothedAx) * gAlpha;
    this.smoothedAy += (rawAy - this.smoothedAy) * gAlpha;
    this.smoothedAz += (rawAz - this.smoothedAz) * gAlpha;

    const speedKmh = speedMs * 3.6;
    const speedMph = speedKmh * 0.621371;

    this.telemetry.updateTimersAndGForces(
      speedKmh,
      speedMs,
      this.smoothedAx,
      this.smoothedAz,
      inputs.throttle,
      this.totalSimTime,
      dt
    );

    this.telemetry.updateDriftScore(speedKmh, localVel.x, localVel.z, dt);

    // Exhaust flame timer
    if (this.powertrain.turboBlowOff || (this.powertrain.isRevLimiting && this.powertrain.revCutBounce)) {
      this.exhaustFlameTimer = 0.15;
    } else if (this.exhaustFlameTimer > 0) {
      this.exhaustFlameTimer -= dt;
    }
  }

  /**
   * Export complete read-only VehicleState snapshot for rendering, UI, audio, and tests
   */
  public getState(): VehicleState {
    const pos = this.rigidBody.position;
    const euler = this.rigidBody.getEuler();
    const localVel = this.rigidBody.getLocalVelocity();
    const localW = this.rigidBody.getLocalAngularVelocity();
    const speedMs = PhysicsMath.vec3Length(this.rigidBody.velocity);
    const speedKmh = speedMs * 3.6;
    const speedMph = speedKmh * 0.621371;

    const hardpointsBody = this.getHardpointsBody();

    // Map 4 WheelStates
    const wheelStates: [WheelState, WheelState, WheelState, WheelState] = this.wheels.map((w, idx) => {
      const susp = this.suspension.states[idx];
      const tire = w.lastTireOutput;
      const hp = hardpointsBody[idx];
      const surface = this.surfaceProvider.sampleSurface(susp.contactPointWorld.x, susp.contactPointWorld.z);

      return {
        id: w.id,
        isFront: w.isFront,
        isLeft: w.isLeft,
        localPos: { x: hp.x, y: hp.y, z: hp.z },
        steerAngle: w.steerAngle,
        camberAngleDeg: susp.dynamicCamberDeg,
        rotationAngle: w.rotationAngle,
        angularVelocity: w.angularVelocity,
        suspensionCompression: susp.compressionRatio,
        damperVelocity: susp.velocity,
        verticalTravelM: susp.hubTravelM,
        bumpStopEngaged: susp.bumpStopEngaged,
        suspensionForce: susp.tireNormalForceN,
        slipAngle: w.relaxationSlipAngle,
        slipRatio: w.relaxationSlipRatio,
        pneumaticTrail: tire.pneumaticTrail,
        aligningTorque: tire.aligningTorque,
        sidewallDeflection: tire.sidewallDeflection,
        tireSquishM: tire.tireSquishM,
        isAirborne: susp.isAirborne,
        isSkidding: tire.isSkidding,
        skidIntensity: tire.skidIntensity,
        groundContactPos: {
          x: susp.contactPointWorld.x,
          y: susp.contactPointWorld.y,
          z: susp.contactPointWorld.z,
        },
        hubWorldPos: {
          x: susp.contactPointWorld.x,
          y: susp.hubPositionWorldY,
          z: susp.contactPointWorld.z,
        },
        temperature: w.temperature,
        pressurePsi: w.pressurePsi,
        tireWearPercent: w.wearPercent,
        grainPercent: 0,
        brakeRotorTemp: w.brakeRotorTemp,
        surfaceType: surface.type,
        surfaceFriction: surface.friction,
        forceVectorLong: tire.fx,
        forceVectorLat: tire.fy,
        forceVectorNorm: susp.tireNormalForceN,
        frictionLimitN: tire.frictionLimit,
        gripUtilization: tire.gripUtilization,
        absActive: this.driverAids.absActive && this.brakes.pressureModulators[idx] < 0.9,
        tcsActive: this.driverAids.tcsActive,
      };
    }) as [WheelState, WheelState, WheelState, WheelState];

    const airborneCount = this.suspension.states.filter((s) => s.isAirborne).length;
    const cgSurface = this.surfaceProvider.sampleSurface(pos.x, pos.z);

    const shiftStage = this.telemetry.getShiftLightStage(
      this.powertrain.engineRpm,
      this.config.maxRpm,
      this.config.revLimiterRpm
    );

    const driftInfo = this.telemetry.updateDriftScore(speedKmh, localVel.x, localVel.z, 0);

    return {
      x: pos.x,
      y: pos.y,
      z: pos.z,
      yaw: euler.yaw,
      pitch: euler.pitch * this.config.bodyPitchMultiplier,
      roll: euler.roll * this.config.bodyRollMultiplier,
      // Heave is CG motion relative to the local road, not world altitude.
      heave: pos.y - cgSurface.elevation - this.config.centerOfGravityHeight,
      vx: localVel.x,
      vy: localVel.y,
      vz: localVel.z,
      yawRate: localW.y,
      rollRate: localW.z,
      pitchRate: localW.x,
      speedMs,
      speedKmh,
      speedMph,
      rpm: this.powertrain.engineRpm,
      flywheelRpm: this.powertrain.flywheelRpm,
      gear: this.powertrain.gear,
      isAutomatic: this.powertrain.isAutomatic,
      clutchEngaged: this.powertrain.clutchEngaged,
      clutchPedal: this.powertrain.clutchPedal,
      clutchKickImpulse: this.powertrain.clutchEngaged ? 0 : 1.0,
      isRevLimiting: this.powertrain.isRevLimiting,
      revCutBounce: this.powertrain.revCutBounce,
      engineTorqueDelivered: this.powertrain.deliveredDriveshaftTorque,
      throttle: this.powertrain.engineTorqueOutput > 0 ? 1 : 0,
      brake: 0,
      handbrake: false,
      absActive: this.driverAids.absActive,
      tcsActive: this.driverAids.tcsActive,
      driftAngle: driftInfo.angle,
      driftScore: driftInfo.score,
      comboMultiplier: driftInfo.combo,
      lateralG: this.smoothedAx,
      longitudinalG: this.smoothedAz,
      verticalG: this.smoothedAy,
      wheels: wheelStates,
      totalAligningTorque: wheelStates.reduce((sum, w) => sum + w.aligningTorque, 0),
      actualSteerAngle: (this.wheels[0].steerAngle + this.wheels[1].steerAngle) * 0.5,
      airborneCount,
      exhaustFlameActive: this.exhaustFlameTimer > 0,
      exhaustFlameIntensity: Math.min(1, this.exhaustFlameTimer / 0.15),
      drsActive: this.aero.drsActive,
    };
  }
}

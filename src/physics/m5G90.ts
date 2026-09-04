import type { VehicleConfig } from '../types';

/** 2025 BMW M5 (G90) instrumented-test calibration. */
export const BMW_M5_2025_OVERRIDES: Partial<VehicleConfig> & Record<string, any> = {
  // Car and Driver's instrumented car measured 5,251 lb with 54.5% on the front axle.
  // BMW publishes a 3,006 mm wheelbase and 1,684 / 1,660 mm front/rear tracks. Keep
  // the existing measured-test wheelbase conversion so benchmark history remains
  // continuous, but use the actual unequal axle tracks for mass moments and wheel
  // hardpoints. trackWidth remains the front-track compatibility value used by the
  // steering system when a single track is required.
  mass: 2381.8135,
  weightDistributionFront: 0.545,
  centerOfGravityHeight: 0.52,
  wheelbase: 3.00482,
  trackWidth: 1.684,
  trackWidthFront: 1.684,
  trackWidthRear: 1.660,

  // The PHEV battery is explicitly represented as low-mounted mass in the inertia
  // derivation instead of lowering an arbitrary roll-inertia multiplier. BMW states
  // that the high-voltage battery is mounted in the underbody and lowers the CG, but
  // does not publish the complete pack mass. 280 kg is therefore an engineering
  // estimate used only to distribute the already-measured total mass vertically;
  // total mass and the configured 0.52 m CG remain authoritative.
  batteryMassKg: 280,
  batteryCgHeight: 0.23,
  batteryPackThickness: 0.14,
  chassisMassHeight: 0.90,

  wheelRadius: 0.369,
  wheelInertia: 2.10,
  unsprungMassCorner: 55,

  suspensionRestLength: 0.34,
  suspensionStiffness: 62000,
  suspensionDamping: 5000,
  suspensionDampingLowSpeed: 5200,
  suspensionDampingHighSpeed: 3000,
  suspensionReboundDamping: 6500,
  bumpStopStiffness: 70000,
  bumpStopTravelThreshold: 0.80,
  rollStiffnessFront: 46000,
  rollStiffnessRear: 40000,
  antiRollCrossCoupling: 0.30,
  camberStaticFront: -1.5,
  camberStaticRear: -1.2,
  camberGain: 7.5,
  antiDiveFront: 0.45,
  antiSquatRear: 0.35,
  // Render exactly the rigid-body pitch/roll produced by the suspension and tire forces.
  // No visual multiplier is allowed on the M5 calibration.
  bodyRollMultiplier: 1.0,
  bodyPitchMultiplier: 1.0,

  tireGripFront: 1.21,
  tireGripRear: 1.20,
  // Heavy-G90 pure-curve progression: soften initial BCD ~13% without touching
  // peak mu. Keeps longitudinal peak ~0.14-0.15 and lateral peak ~0.15-0.17 rad
  // inside existing realistic windows while giving a more communicative top.
  tireStiffness: 13.2,
  longitudinalShapeC: 1.62,
  lateralShapeC: 1.58,
  longitudinalCurvatureE: 0.50,
  lateralCurvatureE: 0.35,
  tireLoadSensitivity: 0.000030,
  slideFrictionMultiplier: 0.83,
  // The G90's heavy chassis should not see peak lateral tire force in the same
  // 120 Hz frame as a steering step. A longer lateral relaxation length gives the
  // contact patch/carcass time to take a set before load reaches the sprung body.
  // Longitudinal relaxation remains independent below so acceleration/braking
  // response is unchanged.
  relaxationLength: 0.50,
  longitudinalRelaxationLength: 0.12,
  longitudinalForceRelaxationLength: 0.066,
  tirePneumaticTrailMax: 0.030,
  tireSidewallStiffness: 230000,
  tireVerticalStiffness: 280000,
  tireVerticalDamping: 1800,
  tireBasePressure: 35.0,
  optimalTireTemp: 75,
  driftAssist: 0.0,

  // The test data does not provide a measured road-car downforce map, so do not
  // invent aerodynamic load merely to force a benchmark result.
  aeroDownforceFront: 0,
  aeroDownforceRear: 0,
  aeroDragCoeff: 0.35,
  aeroCopPitchSensitivity: 0.04,
  groundEffectUnderbody: false,
  groundEffectMaxDownforce: 0,
  drsEnabled: false,
  airbrakeEnabled: false,

  drivetrain: 'AWD',
  differentialType: 'TORQUE_VECTOR',
  centerFrontTorqueRatio: 0.40,
  diffPowerRamp: 0.88,
  diffCoastRamp: 0.48,
  diffPreloadTorque: 100,
  diffLockRatio: 0.88,

  // maxTorque is the pre-boost base curve in this engine. Turbo boost and the
  // low-rpm hybrid fill below produce the system delivery without inflating the
  // real car's ~130 mph quarter-mile trap speed.
  maxTorque: 700,
  maxRpm: 7200,
  idleRpm: 750,
  revLimiterRpm: 7100,
  flywheelInertia: 0.28,
  engineBrakingTorque: 100,
  clutchBiteRate: 20.0,
  maxClutchTorque: 1500,
  transmissionEfficiency: 0.94,
  turboBoostMaxPsi: 18.0,
  turboSpoolRate: 12.0,
  wastegatePressurePsi: 17.5,
  reverseRatio: -3.97,
  forwardGearRatios: [5.00, 3.20, 2.14, 1.72, 1.30, 1.00, 0.83, 0.64],
  gearRatios: [-3.97, 5.00, 3.20, 2.14, 1.72, 1.30, 1.00, 0.83, 0.64],
  finalDriveRatio: 3.31,

  // Retain one speed-independent hydraulic calibration rather than adding a
  // low-speed brake multiplier solely to erase the remaining 70-0 test residual.
  brakeForce: 10800,
  handbrakeForce: 10000,
  brakeBiasFront: 0.60,
  ackermannRatio: 0.90,
  maxSteerAngle: 0.58,
  steerSpeed: 4.8,
  steerSpeedReduction: 0.60,
  rearSteerMaxDeg: 1.5,
  rearSteerTransitionSpeedMs: 20.0,
  absMode: 'FULL',
  tcsMode: 'SPORT',
  tcsSportSlipThreshold: 0.16,
  tcsSportResponse: 30.0,
  tcsSportGain: 2.6,

  launchControlEnabled: true,
  launchControlRpm: 3000,
  lowSpeedTorqueFillNm: 600,
  torqueFillFadeRpm: 3200,
  automaticTorqueConverter: true,
  shiftDurationSec: 0.07,
  shiftTorqueMultiplier: 0.80,
  drivelineInputInertia: 0.35,
  drivelineInertiaCoupling: 1.0,
};

/** Published Car and Driver acceleration figures; those figures exclude 1-foot rollout. */
export const BMW_M5_2025_TARGETS = {
  zeroTo30MphSec: 1.1,
  zeroTo60MphSec: 3.0,
  zeroTo100MphSec: 6.7,
  quarterMileSec: 10.9,
  quarterMileTrapMph: 130,
  braking70To0Ft: 157,
  braking100To0Ft: 324,
  skidpadG: 0.98,
};

/** Equivalent true-standing-start targets for the simulator's zero-speed stopwatch. */
export const BMW_M5_2025_STANDING_TARGETS = {
  zeroTo30MphSec: 1.3,
  zeroTo60MphSec: 3.2,
  zeroTo100MphSec: 6.9,
  quarterMileSec: 11.1,
  quarterMileTrapMph: 130,
};

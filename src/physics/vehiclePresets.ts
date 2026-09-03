import { VehicleConfig, VehiclePreset } from '../types';
import { BMW_M5_2025_OVERRIDES } from './m5G90';

export const DEFAULT_VEHICLE_CONFIG: VehicleConfig = {
  // Mass & Geometry
  mass: 1540, // kg
  weightDistributionFront: 0.52,
  centerOfGravityHeight: 0.46, // meters
  wheelbase: 2.72, // meters
  trackWidth: 1.62, // meters
  ackermannRatio: 0.85, // 85% Ackermann steering geometry
  wheelRadius: 0.33,
  wheelInertia: 1.25,
  unsprungMassCorner: 42,

  // Advanced 2-Way Suspension Kinematics, Valving & Bump Stops
  suspensionRestLength: 0.35,
  suspensionStiffness: 42000, // N/m
  suspensionDamping: 3400, // N/(m/s)
  suspensionDampingLowSpeed: 3800, // N/(m/s) low-speed chassis control
  suspensionDampingHighSpeed: 2100, // N/(m/s) high-speed bump/kerb compliance
  suspensionReboundDamping: 4900, // N/(m/s) rebound damping
  bumpStopStiffness: 48000, // N/m progressive bump stop rate
  bumpStopTravelThreshold: 0.82, // engages at 82% compression
  rollStiffnessFront: 32000,
  rollStiffnessRear: 24000,
  antiRollCrossCoupling: 0.35, // 35% cross-axle kerb jounce coupling
  camberStaticFront: -2.0, // degrees
  camberStaticRear: -1.4, // degrees
  camberGain: 9.2, // deg per meter bump
  antiDiveFront: 0.35,
  antiSquatRear: 0.30,
  bodyRollMultiplier: 1.40, // Generous, authentic body roll
  bodyPitchMultiplier: 1.30, // Authentic squat & dive
  chassisRollInertia: 540,
  chassisPitchInertia: 1480,

  // Full Pacejka '96 Magic Formula Tires, Thermals, Wear & Sidewall Flex
  tireGripFront: 1.22,
  tireGripRear: 1.22,
  tireStiffness: 15.5,
  tireLoadSensitivity: 0.000035, // mu reduction per N load
  slideFrictionMultiplier: 0.84,
  relaxationLength: 0.16, // meters
  tirePneumaticTrailMax: 0.032, // meters (32mm peak pneumatic trail)
  tireSidewallStiffness: 180000, // N/m lateral carcass stiffness
  tireVerticalStiffness: 240000, // N/m vertical spring rate
  tireVerticalDamping: 1500,
  driftAssist: 0.20,
  tireBasePressure: 32.0,
  optimalTireTemp: 85,
  tireWearRate: 1.0,
  ambientSurfaceFrictionMultiplier: 1.0,

  // Aerodynamic Drag & Downforce
  aeroDownforceFront: 240, // N at 100 km/h
  aeroDownforceRear: 380, // N at 100 km/h
  aeroDragCoeff: 0.32,
  aeroCopPitchSensitivity: 0.045,
  groundEffectUnderbody: false,
  groundEffectMaxDownforce: 0,
  aeroDiffuserStallHeight: 0.035,
  drsEnabled: false,
  drsDragReduction: 0.35,
  drsDownforceReduction: 0.45,
  airbrakeEnabled: false,

  // Powertrain, Flywheel Inertia, Clutch & Differential
  drivetrain: 'RWD',
  differentialType: 'CLUTCH_1_5',
  diffPowerRamp: 0.70, // 70% lock on throttle acceleration
  diffCoastRamp: 0.35, // 35% lock on coast / trailing brake
  diffPreloadTorque: 45, // 45 Nm static preload
  diffLockRatio: 0.65,
  maxTorque: 540, // Nm
  maxRpm: 7600,
  idleRpm: 850,
  revLimiterRpm: 7450, // 7450 RPM spark-cut
  flywheelInertia: 0.18, // kg*m^2
  engineBrakingTorque: 85, // Nm trailing engine braking
  clutchBiteRate: 14.0,
  maxClutchTorque: 1200,
  transmissionEfficiency: 0.95,
  clutchKickTorqueMultiplier: 2.2, // 2.2x torque snap on clutch kick
  antiLagEnabled: false,
  autoBlipDownshift: true,
  turboBoostMaxPsi: 18.0,
  turboSpoolRate: 3.5,
  wastegatePressurePsi: 17.5,
  reverseRatio: -3.40,
  forwardGearRatios: [3.82, 2.36, 1.68, 1.29, 1.00, 0.79],
  gearRatios: [-3.4, 3.82, 2.36, 1.68, 1.29, 1.0, 0.79], // R, 1, 2, 3, 4, 5, 6
  finalDriveRatio: 3.45,
  brakeForce: 10500,
  handbrakeForce: 7800,
  brakeBiasFront: 0.62,
  maxSteerAngle: 0.65, // ~37 degrees
  steerSpeed: 5.2,
  steerSpeedReduction: 0.58,

  // Driver Aids
  absMode: 'SPORT',
  tcsMode: 'SPORT',
  launchControlEnabled: true,
};

export const VEHICLE_PRESETS: Record<string, VehiclePreset> = {
  m5G90: {
    name: '2025 BMW M5 (G90)',
    tagline: '5,251 lb measured G90 • 717 hp M Hybrid • rear-biased M xDrive',
    description: 'Calibrated from instrumented 2025 G90 M5 measurements, BMW gearing and tire geometry, adaptive rear-biased AWD, and active rear steering.',
    color: '#111827',
    config: BMW_M5_2025_OVERRIDES,
  },
  sportGT: {
    name: 'Sports GT (Pacejka Multi-Link)',
    tagline: 'Balanced 1,540 kg chassis with 1.5-Way LSD & dynamic camber gain',
    description: 'A finely balanced grand tourer with responsive rear-wheel drive, mechanical 1.5-way clutch LSD, dynamic camber gain into high-speed apexes, and progressive weight transfer.',
    color: '#2563eb', // Sapphire Blue
    config: {
      mass: 1540,
      centerOfGravityHeight: 0.46,
      ackermannRatio: 0.85,
      bodyRollMultiplier: 1.40,
      bodyPitchMultiplier: 1.30,
      suspensionStiffness: 42000,
      suspensionDampingLowSpeed: 3800,
      suspensionDampingHighSpeed: 2100,
      bumpStopStiffness: 48000,
      tireGripFront: 1.22,
      tireGripRear: 1.22,
      tirePneumaticTrailMax: 0.032,
      tireSidewallStiffness: 180000,
      groundEffectUnderbody: false,
      groundEffectMaxDownforce: 0,
      drivetrain: 'RWD',
      differentialType: 'CLUTCH_1_5',
      diffPowerRamp: 0.70,
      diffCoastRamp: 0.35,
      diffPreloadTorque: 45,
      diffLockRatio: 0.65,
      maxTorque: 540,
      revLimiterRpm: 7450,
      turboBoostMaxPsi: 18.0,
      wastegatePressurePsi: 17.5,
      drsEnabled: false,
      airbrakeEnabled: false,
      clutchKickTorqueMultiplier: 2.2,
      absMode: 'SPORT',
      tcsMode: 'SPORT',
    },
  },
  driftMissile: {
    name: 'Drift Pro Spec (2-Way LSD)',
    tagline: '100% Locked 2-Way LSD, 44° steering lock & instant clutch kicks',
    description: 'Purpose-built pro drift machine. Features a 2-way locking differential, 44-degree steering angle, clutch-kick drift assist, low-mass flywheel, and rapid counter-steer torque stabilization.',
    color: '#ea580c', // Hot Ember Orange
    config: {
      mass: 1290,
      centerOfGravityHeight: 0.43,
      ackermannRatio: 0.20, // Near-parallel steering for drift transition control
      bodyRollMultiplier: 1.25,
      bodyPitchMultiplier: 1.15,
      suspensionStiffness: 48000,
      suspensionDampingLowSpeed: 4400,
      suspensionDampingHighSpeed: 2400,
      bumpStopStiffness: 55000,
      tireGripFront: 1.28,
      tireGripRear: 0.96,
      slideFrictionMultiplier: 0.89,
      relaxationLength: 0.12,
      tirePneumaticTrailMax: 0.018,
      tireSidewallStiffness: 220000,
      driftAssist: 0.38,
      groundEffectUnderbody: false,
      drivetrain: 'RWD',
      differentialType: 'CLUTCH_2_WAY',
      diffPowerRamp: 0.95,
      diffCoastRamp: 0.95,
      diffPreloadTorque: 80,
      diffLockRatio: 0.95,
      flywheelInertia: 0.12,
      clutchKickTorqueMultiplier: 3.2,
      engineBrakingTorque: 110,
      maxTorque: 640,
      revLimiterRpm: 8100,
      maxRpm: 8300,
      turboBoostMaxPsi: 22.0,
      wastegatePressurePsi: 21.0,
      maxSteerAngle: 0.77, // ~44 degrees
      camberStaticFront: -3.6,
      camberStaticRear: -0.8,
      drsEnabled: false,
      absMode: 'OFF',
      tcsMode: 'OFF',
    },
  },
  supercarAero: {
    name: 'GT3 Cup (Active Aero & DRS)',
    tagline: 'High-downforce ground effect, deployable DRS wing & torque vectoring',
    description: 'Track-honed racing machine with Venturi underbody ground effect tunnels, deployable DRS, active airbrake pitch compensation, ultra-stiff 2-way valved coilovers, and competition slick tires.',
    color: '#10b981', // Emerald GT3 Green
    config: {
      mass: 1220,
      weightDistributionFront: 0.46,
      centerOfGravityHeight: 0.38,
      ackermannRatio: 0.92,
      bodyRollMultiplier: 0.75,
      bodyPitchMultiplier: 0.70,
      suspensionStiffness: 64000,
      suspensionDampingLowSpeed: 5800,
      suspensionDampingHighSpeed: 3200,
      bumpStopStiffness: 68000,
      rollStiffnessFront: 46000,
      rollStiffnessRear: 39000,
      camberStaticFront: -3.2,
      camberStaticRear: -2.4,
      tireGripFront: 1.42,
      tireGripRear: 1.39,
      tirePneumaticTrailMax: 0.038,
      tireSidewallStiffness: 260000,
      aeroDownforceFront: 420,
      aeroDownforceRear: 680,
      groundEffectUnderbody: true,
      groundEffectMaxDownforce: 950,
      aeroDiffuserStallHeight: 0.030,
      aeroCopPitchSensitivity: 0.07,
      drsEnabled: true,
      drsDragReduction: 0.40,
      drsDownforceReduction: 0.50,
      airbrakeEnabled: true,
      drivetrain: 'AWD',
      differentialType: 'TORQUE_VECTOR',
      diffPowerRamp: 0.85,
      diffCoastRamp: 0.55,
      diffLockRatio: 0.80,
      maxTorque: 620,
      revLimiterRpm: 8800,
      maxRpm: 9000,
      turboBoostMaxPsi: 24.0,
      wastegatePressurePsi: 23.0,
      absMode: 'SPORT',
      tcsMode: 'SPORT',
    },
  },
  classicMuscle: {
    name: 'V8 Supercharged Muscle',
    tagline: '760 Nm blown V8, spool locked diff & heavy flywheel launch squat',
    description: 'Front-heavy supercharged V8 muscle car with a spool locked rear axle. Produces massive standing-start burnouts, heavy flywheel rotational inertia, and trailing throttle-lift oversteer.',
    color: '#dc2626', // Crimson Red
    config: {
      mass: 1720,
      weightDistributionFront: 0.58,
      centerOfGravityHeight: 0.52,
      ackermannRatio: 0.70,
      bodyRollMultiplier: 1.65,
      bodyPitchMultiplier: 1.85,
      suspensionStiffness: 34000,
      suspensionDampingLowSpeed: 3200,
      suspensionDampingHighSpeed: 1800,
      bumpStopStiffness: 42000,
      tireGripFront: 1.14,
      tireGripRear: 1.06,
      tirePneumaticTrailMax: 0.024,
      tireSidewallStiffness: 150000,
      groundEffectUnderbody: false,
      drivetrain: 'RWD',
      differentialType: 'SPOOL',
      diffPowerRamp: 1.0,
      diffCoastRamp: 1.0,
      diffLockRatio: 1.0,
      flywheelInertia: 0.28,
      engineBrakingTorque: 125,
      clutchKickTorqueMultiplier: 2.8,
      maxTorque: 760,
      revLimiterRpm: 6600,
      maxRpm: 6800,
      turboBoostMaxPsi: 14.0,
      wastegatePressurePsi: 13.5,
      drsEnabled: false,
      absMode: 'OFF',
      tcsMode: 'OFF',
    },
  },
  heavyLuxury: {
    name: 'Heavy Executive Cruiser',
    tagline: '2,050 kg presidential sedan with plush air suspension body roll',
    description: 'Substantial vehicle mass combined with softer air springs creates luxurious, flowing body roll through turns, noticeable dive under hard braking, and smooth bump compliance.',
    color: '#0f172a', // Obsidian Black
    config: {
      mass: 2050,
      centerOfGravityHeight: 0.53,
      ackermannRatio: 0.90,
      bodyRollMultiplier: 1.85,
      bodyPitchMultiplier: 1.65,
      suspensionStiffness: 31000,
      suspensionDampingLowSpeed: 2900,
      suspensionDampingHighSpeed: 1600,
      bumpStopStiffness: 38000,
      rollStiffnessFront: 20000,
      rollStiffnessRear: 16000,
      tireGripFront: 1.12,
      tireGripRear: 1.10,
      tirePneumaticTrailMax: 0.028,
      tireSidewallStiffness: 160000,
      groundEffectUnderbody: false,
      drivetrain: 'AWD',
      differentialType: 'OPEN',
      diffPowerRamp: 0.20,
      diffCoastRamp: 0.10,
      diffLockRatio: 0.30,
      maxTorque: 680,
      revLimiterRpm: 6400,
      maxRpm: 6600,
      turboBoostMaxPsi: 16.0,
      wastegatePressurePsi: 15.0,
      drsEnabled: false,
      absMode: 'FULL',
      tcsMode: 'FULL',
    },
  },
  rallyGroupB: {
    name: 'Rally Group B (Turbo AWD)',
    tagline: 'Long-travel rally suspension, aggressive boost spool & 4-wheel slides',
    description: 'Extended suspension travel with high bump damping and locked all-wheel drive. Absorbs violent high-speed crests and transitions effortlessly into wide 4-wheel power drifts.',
    color: '#0284c7', // Rally Azure
    config: {
      mass: 1280,
      weightDistributionFront: 0.52,
      centerOfGravityHeight: 0.48,
      ackermannRatio: 0.75,
      suspensionRestLength: 0.42,
      bodyRollMultiplier: 1.50,
      bodyPitchMultiplier: 1.40,
      suspensionStiffness: 35000,
      suspensionDampingLowSpeed: 4200,
      suspensionDampingHighSpeed: 2800,
      bumpStopStiffness: 60000,
      camberStaticFront: -1.8,
      camberStaticRear: -1.2,
      tireGripFront: 1.24,
      tireGripRear: 1.22,
      tirePneumaticTrailMax: 0.026,
      tireSidewallStiffness: 170000,
      groundEffectUnderbody: false,
      drivetrain: 'AWD',
      differentialType: 'CLUTCH_2_WAY',
      diffPowerRamp: 0.85,
      diffCoastRamp: 0.85,
      diffLockRatio: 0.85,
      flywheelInertia: 0.14,
      antiLagEnabled: true,
      clutchKickTorqueMultiplier: 2.5,
      maxTorque: 590,
      revLimiterRpm: 8400,
      maxRpm: 8600,
      turboBoostMaxPsi: 25.0,
      wastegatePressurePsi: 24.5,
      drsEnabled: false,
      absMode: 'OFF',
      tcsMode: 'OFF',
    },
  },
};
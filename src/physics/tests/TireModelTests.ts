import { TireModel, TireModelConfig } from '../TireModel';

const assert = (condition: boolean, message: string) => {
  if (!condition) throw new Error(message);
};

const config: TireModelConfig = {
  baseGrip: 1.21,
  stiffnessB: 15,
  loadSensitivity: 0.000030,
  slideFrictionMultiplier: 0.83,
  relaxationLength: 0.19,
  pneumaticTrailMax: 0.03,
  camberStiffness: 85,
  optimalTemp: 75,
  basePressurePsi: 35,
  referenceLoadN: 6200,
};

const tire = new TireModel(config);
const calculate = (slipRatio: number, slipAngle: number, verticalLoad = 6200) =>
  tire.calculate({
    slipRatio,
    slipAngle,
    verticalLoad,
    camberDeg: 0,
    surfaceFriction: 1,
    isLeft: true,
  });

// ---------------------------------------------------------------------------
// Pure longitudinal curve
// ---------------------------------------------------------------------------
const longitudinalSamples = Array.from({ length: 121 }, (_, i) => i * 0.0025)
  .map((slipRatio) => ({ slipRatio, output: calculate(slipRatio, 0) }));
const longitudinalPeak = longitudinalSamples.reduce((peak, sample) =>
  Math.abs(sample.output.fx) > Math.abs(peak.output.fx) ? sample : peak
);

assert(
  longitudinalPeak.slipRatio > 0.08 && longitudinalPeak.slipRatio < 0.16,
  `longitudinal peak must land in a realistic performance-road-tire window: ${longitudinalPeak.slipRatio}`
);
assert(Math.abs(calculate(0, 0).fx) < 1e-9, 'zero longitudinal slip must produce zero Fx');
assert(
  Math.abs(calculate(-0.10, 0).fx + calculate(0.10, 0).fx) < 1e-6,
  'pure longitudinal force must be antisymmetric'
);

// ---------------------------------------------------------------------------
// Pure lateral curve
// ---------------------------------------------------------------------------
const lateralSamples = Array.from({ length: 121 }, (_, i) => i * 0.002)
  .map((slipAngle) => ({ slipAngle, output: calculate(0, slipAngle) }));
const lateralPeak = lateralSamples.reduce((peak, sample) =>
  Math.abs(sample.output.fy) > Math.abs(peak.output.fy) ? sample : peak
);

assert(
  lateralPeak.slipAngle > 0.08 && lateralPeak.slipAngle < 0.18,
  `lateral peak must land in a realistic performance-road-tire window: ${lateralPeak.slipAngle}`
);
assert(
  Math.abs(calculate(0, -0.10).fy + calculate(0, 0.10).fy) < 1e-6,
  'pure lateral force must be antisymmetric without camber'
);

// ---------------------------------------------------------------------------
// Load sensitivity
// ---------------------------------------------------------------------------
const lowLoad = calculate(0.12, 0, 3100);
const referenceLoad = calculate(0.12, 0, 6200);
const highLoad = calculate(0.12, 0, 9300);

assert(
  lowLoad.effectiveMu > referenceLoad.effectiveMu && referenceLoad.effectiveMu > highLoad.effectiveMu,
  'effective friction coefficient must fall as vertical load rises'
);
assert(
  highLoad.fx < referenceLoad.fx * 1.5,
  '50% more vertical load must produce less than 50% more longitudinal force'
);

// ---------------------------------------------------------------------------
// Combined slip / trail braking
// ---------------------------------------------------------------------------
const pureLateral = calculate(0, 0.10);
const pureBraking = calculate(-0.12, 0);
const trailBraking = calculate(-0.12, 0.10);

assert(
  Math.abs(trailBraking.fy) < Math.abs(pureLateral.fy) * 0.95,
  'braking slip must progressively consume lateral capacity'
);
assert(
  Math.abs(trailBraking.fx) < Math.abs(pureBraking.fx) * 0.95,
  'steering slip must progressively consume longitudinal capacity'
);
assert(
  (trailBraking.combinedSlipUtilization ?? 0) <= 1.000001,
  'combined forces must remain inside the superellipse envelope'
);

// ---------------------------------------------------------------------------
// Aligning torque + post-peak sliding behavior
// ---------------------------------------------------------------------------
const lowSlipTrail = calculate(0, 0.03).pneumaticTrail;
const highSlipTrail = calculate(0, 0.20).pneumaticTrail;
const deepSlide = calculate(1.0, 0);

assert(lowSlipTrail > highSlipTrail, 'pneumatic trail must fall as slip angle approaches saturation');
assert(
  Math.abs(deepSlide.fx) < Math.abs(longitudinalPeak.output.fx),
  'deep wheelspin/lock must settle below peak longitudinal grip'
);

// ---------------------------------------------------------------------------
// Independent lateral/longitudinal stiffness + broader road-tire working range
// ---------------------------------------------------------------------------
const progressiveConfig: TireModelConfig = {
  ...config,
  longitudinalStiffnessB: 15,
  lateralStiffnessB: 13.5,
  slideFrictionMultiplier: 0.86,
};
const progressiveTire = new TireModel(progressiveConfig);
const progressiveCalculate = (slipRatio: number, slipAngle: number) =>
  progressiveTire.calculate({
    slipRatio,
    slipAngle,
    verticalLoad: 6200,
    camberDeg: 0,
    surfaceFriction: 1,
    isLeft: true,
  });
const progressiveLongitudinal = Array.from({ length: 121 }, (_, i) => i * 0.0025)
  .map((slipRatio) => ({ slipRatio, output: progressiveCalculate(slipRatio, 0) }));
const progressiveLongPeak = progressiveLongitudinal.reduce((peak, sample) =>
  Math.abs(sample.output.fx) > Math.abs(peak.output.fx) ? sample : peak
);
const progressiveLateral = Array.from({ length: 141 }, (_, i) => i * 0.002)
  .map((slipAngle) => ({ slipAngle, output: progressiveCalculate(0, slipAngle) }));
const progressiveLatPeak = progressiveLateral.reduce((peak, sample) =>
  Math.abs(sample.output.fy) > Math.abs(peak.output.fy) ? sample : peak
);

assert(
  Math.abs(progressiveLongPeak.slipRatio - longitudinalPeak.slipRatio) < 0.003,
  `lateral-stiffness tuning must not move longitudinal peak: base=${longitudinalPeak.slipRatio} tuned=${progressiveLongPeak.slipRatio}`
);
assert(
  progressiveLatPeak.slipAngle > lateralPeak.slipAngle + 0.01 &&
    progressiveLatPeak.slipAngle < 0.17,
  `progressive lateral peak should move into a broader 8-9.5 deg road-tire window: base=${lateralPeak.slipAngle} tuned=${progressiveLatPeak.slipAngle}`
);
assert(
  Math.abs(progressiveLatPeak.output.fy / lateralPeak.output.fy - 1) < 0.01,
  'broader lateral curve must preserve peak lateral force rather than hiding a mu increase'
);
const progressiveDeepSlide = Math.abs(progressiveCalculate(0, 0.50).fy);
const baseDeepSlide = Math.abs(calculate(0, 0.50).fy);
assert(
  progressiveDeepSlide > baseDeepSlide,
  'progressive slide calibration should retain more lateral force after breakaway'
);

console.log(JSON.stringify({
  pureLongitudinal: {
    peakSlipRatio: longitudinalPeak.slipRatio,
    peakForceN: longitudinalPeak.output.fx,
  },
  pureLateral: {
    peakSlipAngleDeg: lateralPeak.slipAngle * 180 / Math.PI,
    peakForceN: lateralPeak.output.fy,
  },
  loadSensitivity: {
    lowLoadMu: lowLoad.effectiveMu,
    referenceLoadMu: referenceLoad.effectiveMu,
    highLoadMu: highLoad.effectiveMu,
  },
  combinedSlip: {
    lateralForceRetention: Math.abs(trailBraking.fy / pureLateral.fy),
    longitudinalForceRetention: Math.abs(trailBraking.fx / pureBraking.fx),
    utilization: trailBraking.combinedSlipUtilization,
  },
  status: 'passed',
}, null, 2));

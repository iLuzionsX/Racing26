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
// M5 G90 heavy-car shape regression: same physics, M5 BCD/shape only.
// Mirrored cases are +/-slipAngle and +/-slipRatio; left/right camber
// cancellation is covered by the antisymmetry checks above.
const m5Shape = new TireModel({ ...config, stiffnessB: 13.2, longitudinalShapeC: 1.62, lateralShapeC: 1.58, longitudinalCurvatureE: 0.50, lateralCurvatureE: 0.35, referenceLoadN: 5800 });
const m5At = (r: number, a: number, fz = 5800) => m5Shape.calculate({ slipRatio: r, slipAngle: a, verticalLoad: fz, camberDeg: 0, surfaceFriction: 1, isLeft: true });
const m5Long = Array.from({ length: 121 }, (_, i) => i * 0.0025).map((r) => ({ r, f: Math.abs(m5At(r, 0).fx) }));
const m5LongPeak = m5Long.reduce((p, s) => (s.f > p.f ? s : p));
const m5Lat = Array.from({ length: 121 }, (_, i) => i * 0.002).map((a) => ({ a, f: Math.abs(m5At(0, a).fy) }));
const m5LatPeak = m5Lat.reduce((p, s) => (s.f > p.f ? s : p));
assert(m5LongPeak.r > 0.08 && m5LongPeak.r < 0.16, `M5 longitudinal peak must stay realistic: ${m5LongPeak.r}`);
assert(m5LatPeak.a > 0.08 && m5LatPeak.a < 0.18, `M5 lateral peak must stay realistic: ${m5LatPeak.a}`);
const m5Stiffness = (Math.abs(m5At(0, 0.01).fy) / 0.01) / 5800;
assert(m5Stiffness > 12 && m5Stiffness < 19, `M5 normalized cornering stiffness must not feel like rock: ${m5Stiffness}`);
const m5Ret2x = Math.abs(m5At(0, m5LatPeak.a * 2).fy) / Math.max(1, m5LatPeak.f);
assert(m5Ret2x > 0.70 && m5Ret2x < 0.95, `M5 must have progressive falloff at 2x peak, not a cliff or flat top: ${m5Ret2x}`);
assert(Math.abs(m5At(0.10, 0).fx + m5At(-0.10, 0).fx) < 1e-6, 'M5 longitudinal must stay antisymmetric');
assert(Math.abs(m5At(0, 0.10).fy + m5At(0, -0.10).fy) < 1e-6, 'M5 lateral must stay antisymmetric');

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

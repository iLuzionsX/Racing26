import assert from 'node:assert/strict';
import { TireModel, type TireModelConfig } from '../TireModel';
import { transformForceToCommandFrame } from '../SuspensionKinematics';

// Advisory diagnostic only: quantifies useful vs full-lock lateral demand.
// No calibration, grip, damping, steering, driveline, brake or assist change.
const M5_FRONT: TireModelConfig = {
  baseGrip: 1.21,
  stiffnessB: 15,
  loadSensitivity: 0.00003,
  slideFrictionMultiplier: 0.83,
  relaxationLength: 0.19,
  pneumaticTrailMax: 0.03,
  camberStiffness: 85,
  optimalTemp: 75,
  basePressurePsi: 35,
  referenceLoadN: 6200,
};

const DEG = 180 / Math.PI;
const tire = new TireModel(M5_FRONT);
const fyAt = (alphaRad: number, fz = 6200) =>
  tire.calculate({ slipRatio: 0, slipAngle: alphaRad, verticalLoad: fz, camberDeg: 0, surfaceFriction: 1, isLeft: true }).fy;

function testUsefulVsFullLockRetention() {
  const degs = [0, 3, 6, 8, 12, 20, 33];
  const fys = degs.map((d) => Math.abs(fyAt((d * Math.PI) / 180)));
  const peak = Math.max(...fys);
  const peakIdx = fys.indexOf(peak);
  const at = (d: number) => fys[degs.indexOf(d)];
  assert(Math.abs(fyAt(0)) < 1e-9, 'zero slip must give zero Fy');
  // Peak must sit in useful performance-tire window, not at full lock.
  assert(peakIdx >= 2 && peakIdx <= 4, `lateral peak must be near 6-12deg, got ${degs[peakIdx]}deg`);
  assert(at(6) > at(3), 'Fy must still build from 3deg to 6deg');
  // Post-peak must decay progressively, not collapse or grow.
  assert(at(33) < at(12), `full-lock Fy must be below 12deg Fy: 33deg=${at(33).toFixed(0)} 12deg=${at(12).toFixed(0)}`);
  assert(at(20) > peak * 0.55, `20deg must retain progressive grip, got ${(at(20) / peak).toFixed(3)}x peak`);
  assert(at(33) > peak * 0.45, `33deg must remain saturated not zero, got ${(at(33) / peak).toFixed(3)}x peak`);
  assert(at(33) < peak, 'full-lock Fy must not exceed peak');
  console.log(JSON.stringify({ sweepDeg: degs, fyN: fys.map((v) => Number(v.toFixed(1))), peakN: Number(peak.toFixed(1)), retention20: Number((at(20) / peak).toFixed(3)), retention33: Number((at(33) / peak).toFixed(3)) }));
}

function testLargeAngleMirrorAndProjection() {
  for (const deg of [6, 12, 20, 33]) {
    const a = (deg * Math.PI) / 180;
    const pos = tire.calculate({ slipRatio: 0, slipAngle: a, verticalLoad: 6200, camberDeg: 0, surfaceFriction: 1, isLeft: true });
    const neg = tire.calculate({ slipRatio: 0, slipAngle: -a, verticalLoad: 6200, camberDeg: 0, surfaceFriction: 1, isLeft: true });
    assert(Math.abs(pos.fy + neg.fy) < 1e-6, `${deg}deg lateral force must be antisymmetric`);
    // Steering-frame rotation must preserve combined-force magnitude.
    const rotated = transformForceToCommandFrame(pos.fx, pos.fy, a);
    const before = Math.hypot(pos.fx, pos.fy);
    const after = Math.hypot(rotated.longitudinal, rotated.lateral);
    assert(Math.abs(before - after) < 1e-9, `${deg}deg projection changed force magnitude`);
  }
  // Left/right camber thrust must mirror and cancel (conventions contract).
  const left = tire.calculate({ slipRatio: 0, slipAngle: 0, verticalLoad: 6200, camberDeg: -2, surfaceFriction: 1, isLeft: true });
  const right = tire.calculate({ slipRatio: 0, slipAngle: 0, verticalLoad: 6200, camberDeg: -2, surfaceFriction: 1, isLeft: false });
  assert(left.fy < 0 && right.fy > 0, 'negative camber must thrust inward mirrored');
  assert(Math.abs(left.fy + right.fy) < 1e-9, 'equal mirrored camber must cancel');
}

function testLoadSensitivitySublinear() {
  const low = tire.calculate({ slipRatio: 0.12, slipAngle: 0, verticalLoad: 3100, camberDeg: 0, surfaceFriction: 1, isLeft: true });
  const ref = tire.calculate({ slipRatio: 0.12, slipAngle: 0, verticalLoad: 6200, camberDeg: 0, surfaceFriction: 1, isLeft: true });
  const high = tire.calculate({ slipRatio: 0.12, slipAngle: 0, verticalLoad: 9300, camberDeg: 0, surfaceFriction: 1, isLeft: true });
  assert(low.effectiveMu > ref.effectiveMu && ref.effectiveMu > high.effectiveMu, 'Mu must fall with load');
  assert(high.fx < ref.fx * 1.5, '50% more load must give <50% more force');
}

const tests: Array<[string, () => void]> = [
  ['useful vs full-lock lateral retention', testUsefulVsFullLockRetention],
  ['large-angle mirror and projection magnitude', testLargeAngleMirrorAndProjection],
  ['load-sensitivity sublinear', testLoadSensitivitySublinear],
];
for (const [name, fn] of tests) {
  fn();
  console.log(`PASS ${name} (${(6).toFixed(0)}deg useful vs 33deg full-lock; left/right mirrored)`);
}
console.log(`TireHandlingAuditTests: PASS all ${tests.length} advisory checks; no tire calibration changed`);

import * as THREE from 'three';
import { CarRenderer } from '../../graphics/carRenderer';
import { WheelDynamics } from '../WheelDynamics';
import { projectTireShearOntoSurface, wheelContactAuthorityForUprightness } from '../Vehicle';
import { PhysicsMath } from '../math/PhysicsMath';
import { DEFAULT_VEHICLE_CONFIG } from '../vehiclePresets';
import { BMW_M5_2025_OVERRIDES } from '../m5G90';
import { ProvingGroundSurfaceProvider } from '../SurfaceProvider';

const DT = 1 / 120;

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function near(a: number, b: number, eps: number = 1e-7) {
  return Math.abs(a - b) <= eps;
}

function makeWheel() {
  return new WheelDynamics({
    id: 'FL',
    isFront: true,
    isLeft: true,
    radius: 0.369,
    inertia: 2.10,
    tireConfig: {
      baseGrip: 1.21,
      stiffnessB: 15.0,
      loadSensitivity: 0.000030,
      slideFrictionMultiplier: 0.83,
      relaxationLength: 0.19,
      longitudinalRelaxationLength: 0.12,
      longitudinalForceRelaxationLength: 0.066,
      pneumaticTrailMax: 0.030,
      camberStiffness: 85,
      optimalTemp: 75,
      basePressurePsi: 35,
      sidewallStiffness: 230000,
      verticalStiffness: 280000,
      referenceLoadN: 6200,
    },
  });
}

function testTireShearStaysInRoadPlane() {
  const normal = PhysicsMath.vec3Normalize({ x: 0.18, y: 0.96, z: -0.21 });
  const raw = { x: 4200, y: 3100, z: -5600 };
  const tangent = projectTireShearOntoSurface(raw, normal);
  const normalLeak = Math.abs(PhysicsMath.vec3Dot(tangent, normal));
  assert(normalLeak < 1e-8, `tire shear leaked ${normalLeak} N into road normal`);
  assert(
    PhysicsMath.vec3Length(tangent) <= PhysicsMath.vec3Length(raw) + 1e-8,
    'road-plane projection created force'
  );
}

function testPostSpinContactPatchSettles() {
  const wheel = makeWheel();
  wheel.reset(12);

  let sawRealSkid = false;
  for (let i = 0; i < 180; i++) {
    const out = wheel.update(12, 8, 6200, -1.5, 0, 0, 0, 1, 0.015, DT);
    sawRealSkid ||= out.isSkidding;
  }
  assert(sawRealSkid, 'high-energy spin phase did not register a skid');

  for (let i = 0; i < 300; i++) {
    const t = 1 - (i + 1) / 300;
    wheel.update(12 * t, 8 * t, 6200, -1.5, 0, 0, 0, 1, 0.015, DT);
  }

  let latePeakForce = 0;
  let lateSkidFrames = 0;
  for (let i = 0; i < 480; i++) {
    const out = wheel.update(0, 0, 6200, -1.5, 0, 0, 0, 1, 0.015, DT);
    if (i >= 240) {
      latePeakForce = Math.max(latePeakForce, Math.hypot(out.fx, out.fy));
      if (out.isSkidding || out.skidIntensity > 0) lateSkidFrames++;
    }
  }

  assert(lateSkidFrames === 0, `settled tire re-entered skid for ${lateSkidFrames} frames`);
  assert(latePeakForce < 80, `settled tire retained ${latePeakForce.toFixed(1)} N oscillatory force`);
}

function testChassisVisualPivotsAtPhysicalCg() {
  const config = { ...DEFAULT_VEHICLE_CONFIG, ...BMW_M5_2025_OVERRIDES } as any;
  const renderer = new CarRenderer('#2563eb');
  const cgOffset = config.centerOfGravityHeight;
  const state: any = {
    x: 12,
    z: -7,
    elevationHeight: 1.4,
    heave: 0.16,
    yaw: 2.2,
    pitch: 0.92,
    roll: 1.18,
    airbrakeActive: false,
    drsActive: false,
    exhaustFlameIntensity: 0,
    wheels: [],
    showForceVectors3D: false,
  };

  renderer.update(state, config);
  renderer.rootGroup.updateMatrixWorld(true);

  assert(
    near(renderer.chassisPivotGroup.position.y, state.heave + cgOffset),
    'body pivot is not located at rigid-body CG height'
  );
  assert(
    near(renderer.chassisGroup.position.y, -cgOffset),
    'body visual is not offset from the CG pivot correctly'
  );

  const before = new THREE.Vector3();
  renderer.chassisPivotGroup.getWorldPosition(before);
  state.pitch = -1.05;
  state.roll = -1.22;
  renderer.update(state, config);
  renderer.rootGroup.updateMatrixWorld(true);
  const after = new THREE.Vector3();
  renderer.chassisPivotGroup.getWorldPosition(after);
  assert(
    before.distanceTo(after) < 1e-7,
    `CG pivot moved ${before.distanceTo(after)} m when only attitude changed`
  );
}

function testWheelAuthorityHandsOffBeforeSidewaysJacking() {
  const a20 = wheelContactAuthorityForUprightness(Math.cos(20 * Math.PI / 180));
  const a45 = wheelContactAuthorityForUprightness(Math.cos(45 * Math.PI / 180));
  const a60 = wheelContactAuthorityForUprightness(Math.cos(60 * Math.PI / 180));
  assert(a20 > 0.999, `20deg authority changed: ${a20}`);
  assert(a45 > 0.35 && a45 < 0.70, `45deg authority did not fade correctly: ${a45}`);
  assert(a60 < 1e-6, `60deg retained jacking authority: ${a60}`);
}

function testProvingGroundCrashDisplacementDoesNotEnterHiddenGravel() {
  const surface = new ProvingGroundSurfaceProvider();
  const center = surface.sampleSurface(0, 0);
  const displacedApron = surface.sampleSurface(40, 200);
  const wetSkidpad = surface.sampleSurface(85, -60);

  assert(center.type === 'racing_line', `center runway type changed to ${center.type}`);
  assert(near(center.friction, 1.10), `center runway friction changed to ${center.friction}`);

  // This is the key crash-recovery guardrail: the visible plane at x=40 m, z=200 m is
  // ordinary asphalt. A lateral impact must not silently put all four tires on
  // invisible 0.55-mu gravel while the player still sees the same asphalt mesh.
  assert(
    displacedApron.type === 'asphalt',
    `visually asphalt apron became hidden ${displacedApron.type}`
  );
  assert(
    near(displacedApron.friction, 1.0),
    `visually asphalt apron friction changed to ${displacedApron.friction}`
  );

  // Preserve the intentionally visible low-grip test surface.
  assert(wetSkidpad.type === 'wet', `wet skidpad type changed to ${wetSkidpad.type}`);
  assert(near(wetSkidpad.friction, 0.42), `wet skidpad friction changed to ${wetSkidpad.friction}`);
}

function testRenderedWheelTracksPhysicalHubDuringWipeout() {
  const config = { ...DEFAULT_VEHICLE_CONFIG, ...BMW_M5_2025_OVERRIDES } as any;
  const renderer = new CarRenderer('#2563eb');
  const state: any = {
    x: 12, z: -7, elevationHeight: 1.4, heave: 0.18, yaw: 0.73,
    pitch: 38 * Math.PI / 180, roll: 57 * Math.PI / 180, airbrakeActive: false, drsActive: false,
    exhaustFlameIntensity: 0, showForceVectors3D: false,
    wheels: [{ id: 'FL', isFront: true, isLeft: true, localPos: { x: -0.84, y: 0, z: 1.36 },
      hubWorldPos: { x: 11.28, y: 1.92, z: -5.74 }, steerAngle: 0.18, camberAngleDeg: -2,
      rotationAngle: 1.2, verticalTravelM: 0.10, tireSquishM: 0.025, sidewallDeflection: 0.01,
      brakeRotorTemp: 80, forceVectorLong: 0, forceVectorLat: 0, forceVectorNorm: 0, gripUtilization: 0,
      isSkidding: false, bumpStopEngaged: false }],
  };
  renderer.update(state, config);
  renderer.rootGroup.updateMatrixWorld(true);
  const actual = new THREE.Vector3();
  renderer.wheelMeshes[0].getWorldPosition(actual);
  const expected = new THREE.Vector3(11.28, 1.92, -5.74);
  assert(actual.distanceTo(expected) < 1e-6, `wheel separated ${actual.distanceTo(expected)} m from physical hub`);
}

const tests: Array<[string, () => void]> = [
  ['tire shear remains tangent to road', testTireShearStaysInRoadPlane],
  ['post-spin contact patch settles', testPostSpinContactPatchSettles],
  ['chassis visual rotates around physical CG', testChassisVisualPivotsAtPhysicalCg],
  ['wheel authority hands off before sideways jacking', testWheelAuthorityHandsOffBeforeSidewaysJacking],
  ['rendered wheel tracks physical hub during wipeout', testRenderedWheelTracksPhysicalHubDuringWipeout],
  ['proving-ground crash displacement does not enter hidden gravel', testProvingGroundCrashDisplacementDoesNotEnterHiddenGravel],
];

for (const [name, test] of tests) {
  test();
  console.log(`PASS ${name}`);
}
console.log(`PASS all ${tests.length} crash-recovery regression tests`);

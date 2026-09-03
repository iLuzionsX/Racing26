import { Simulation } from '../Simulation';
import { RigidBody } from '../RigidBody';
import { deriveChassisMassProperties } from '../ChassisMassProperties';
import { DEFAULT_VEHICLE_CONFIG } from '../vehiclePresets';
import { BMW_M5_2025_OVERRIDES } from '../m5G90';
import { PhysicsMath } from '../math/PhysicsMath';

const assert = (condition: boolean, message: string) => {
  if (!condition) throw new Error(message);
};

const approx = (actual: number, expected: number, tolerance: number, message: string) => {
  if (Math.abs(actual - expected) > tolerance) {
    throw new Error(`${message}: expected ${expected}, got ${actual}`);
  }
};

const finite = (value: number, message: string) =>
  assert(Number.isFinite(value), `${message}: ${value}`);

const config = {
  ...DEFAULT_VEHICLE_CONFIG,
  ...BMW_M5_2025_OVERRIDES,
} as any;

const neutral = {
  throttle: 0,
  brake: 0,
  steer: 0,
  handbrake: false,
  shiftUp: false,
  shiftDown: false,
};

const dt = 1 / 120;
const radToDeg = 180 / Math.PI;

// -----------------------------------------------------------------------------
// 1. Mass-property and r x F invariants
// -----------------------------------------------------------------------------
const m5Props = deriveChassisMassProperties(config);
const lightProps = deriveChassisMassProperties(DEFAULT_VEHICLE_CONFIG as any);

approx(
  m5Props.cgToFrontAxle + m5Props.cgToRearAxle,
  config.wheelbase,
  1e-10,
  'CG-to-axle distances must sum to wheelbase'
);
approx(
  m5Props.cgToRearAxle / config.wheelbase,
  config.weightDistributionFront,
  1e-10,
  'longitudinal CG must reproduce static front weight distribution'
);
approx(m5Props.frontTrack, config.trackWidthFront, 1e-12, 'front track mismatch');
approx(m5Props.rearTrack, config.trackWidthRear, 1e-12, 'rear track mismatch');

assert(m5Props.inertia.x > 4500 && m5Props.inertia.x < 7000,
  `M5 pitch inertia outside road-car range: ${m5Props.inertia.x.toFixed(1)} kg*m^2`);
assert(m5Props.inertia.y > 5000 && m5Props.inertia.y < 7500,
  `M5 yaw inertia outside road-car range: ${m5Props.inertia.y.toFixed(1)} kg*m^2`);
assert(m5Props.inertia.z > 450 && m5Props.inertia.z < 1200,
  `M5 roll inertia outside road-car range: ${m5Props.inertia.z.toFixed(1)} kg*m^2`);
assert(m5Props.inertia.y > lightProps.inertia.y * 1.35,
  `2.38 t M5 should carry materially more yaw inertia than default sports GT: M5=${m5Props.inertia.y.toFixed(0)} light=${lightProps.inertia.y.toFixed(0)}`);

const yawForceN = 6000;
const testYawMomentNm = m5Props.cgToFrontAxle * yawForceN;
const yawBody = new RigidBody({
  mass: config.mass,
  inertia: PhysicsMath.vec3Clone(m5Props.inertia),
  centerOfGravityHeight: config.centerOfGravityHeight,
});
yawBody.addBodyForceAtPoint(
  PhysicsMath.vec3(yawForceN, 0, 0),
  PhysicsMath.vec3(0, -config.centerOfGravityHeight, m5Props.cgToFrontAxle)
);
yawBody.integrate(dt);
approx(
  yawBody.angularAcceleration.y,
  testYawMomentNm / m5Props.inertia.y,
  1e-9,
  'yaw acceleration must equal Mz / Iz'
);

const mirroredYawBody = new RigidBody({
  mass: config.mass,
  inertia: PhysicsMath.vec3Clone(m5Props.inertia),
  centerOfGravityHeight: config.centerOfGravityHeight,
});
mirroredYawBody.addBodyForceAtPoint(
  PhysicsMath.vec3(-yawForceN, 0, 0),
  PhysicsMath.vec3(0, -config.centerOfGravityHeight, m5Props.cgToFrontAxle)
);
mirroredYawBody.integrate(dt);
approx(
  mirroredYawBody.angularAcceleration.y,
  -yawBody.angularAcceleration.y,
  1e-9,
  'left/right yaw moment response must mirror exactly'
);

const rollTorqueNm = 3000;
const pitchTorqueNm = 5000;
const axisBody = new RigidBody({
  mass: config.mass,
  inertia: PhysicsMath.vec3Clone(m5Props.inertia),
  centerOfGravityHeight: config.centerOfGravityHeight,
});
axisBody.addBodyTorque(PhysicsMath.vec3(pitchTorqueNm, 0, rollTorqueNm));
axisBody.integrate(dt);
approx(axisBody.angularAcceleration.x, pitchTorqueNm / m5Props.inertia.x, 1e-9,
  'pitch angular acceleration must use pitch inertia');
approx(axisBody.angularAcceleration.z, rollTorqueNm / m5Props.inertia.z, 1e-9,
  'roll angular acceleration must use roll inertia');

// -----------------------------------------------------------------------------
// Helpers for deterministic full-vehicle maneuvers
// -----------------------------------------------------------------------------
const makeMovingSim = (speedMs: number) => {
  const sim = new Simulation(config);
  sim.reset(0, 0, 0);
  for (let i = 0; i < 300; i++) sim.stepExplicit(neutral, 1);
  sim.vehicle.rigidBody.velocity = PhysicsMath.vec3(0, 0, speedMs);
  sim.vehicle.wheels.forEach((wheel) => wheel.reset(speedMs));
  for (let i = 0; i < 60; i++) sim.stepExplicit(neutral, 1);
  return sim;
};

const steerForCenterAngleDeg = (deg: number) =>
  (deg / radToDeg) / config.maxSteerAngle;

const totalFz = (state: ReturnType<Simulation['vehicle']['getState']>) =>
  state.wheels.reduce((sum, wheel) => sum + wheel.forceVectorNorm, 0);

const axleFz = (state: ReturnType<Simulation['vehicle']['getState']>) => ({
  front: state.wheels[0].forceVectorNorm + state.wheels[1].forceVectorNorm,
  rear: state.wheels[2].forceVectorNorm + state.wheels[3].forceVectorNorm,
  left: state.wheels[0].forceVectorNorm + state.wheels[2].forceVectorNorm,
  right: state.wheels[1].forceVectorNorm + state.wheels[3].forceVectorNorm,
});

const assertFiniteState = (sim: Simulation, label: string) => {
  const state = sim.vehicle.getState();
  const values = [state.x, state.y, state.z, state.yaw, state.pitch, state.roll,
    state.yawRate, state.pitchRate, state.rollRate, state.speedMs,
    ...state.wheels.flatMap((wheel) => [wheel.slipAngle, wheel.forceVectorNorm, wheel.forceVectorLat])];
  values.forEach((value, index) => finite(value, `${label} state[${index}]`));
  assert(Math.abs(state.roll) < 1.25, `${label}: roll diverged to ${(state.roll * radToDeg).toFixed(1)} deg`);
  assert(Math.abs(state.pitch) < 1.25, `${label}: pitch diverged to ${(state.pitch * radToDeg).toFixed(1)} deg`);
  assert(state.speedMs < 120, `${label}: speed diverged to ${(state.speedMs * 3.6).toFixed(0)} km/h`);
  return state;
};

// -----------------------------------------------------------------------------
// 2. Steering step: tire slip -> yaw -> load transfer -> body attitude
// -----------------------------------------------------------------------------
type Trace = {
  t: number;
  steerDeg: number;
  frontSlipDeg: number;
  lateralG: number;
  yawRateDegS: number;
  rollDeg: number;
  fz: [number, number, number, number];
};

const steeringSim = makeMovingSim(20); // 72 km/h
const steeringInput = steerForCenterAngleDeg(3.2);
const trace: Trace[] = [];

for (let step = 0; step < 180; step++) {
  const state = steeringSim.stepExplicit({ ...neutral, steer: steeringInput }, 1);
  trace.push({
    t: (step + 1) * dt,
    steerDeg: state.actualSteerAngle * radToDeg,
    frontSlipDeg: 0.5 * (state.wheels[0].slipAngle + state.wheels[1].slipAngle) * radToDeg,
    lateralG: state.lateralG,
    yawRateDegS: state.yawRate * radToDeg,
    rollDeg: state.roll * radToDeg,
    fz: [
      state.wheels[0].forceVectorNorm,
      state.wheels[1].forceVectorNorm,
      state.wheels[2].forceVectorNorm,
      state.wheels[3].forceVectorNorm,
    ],
  });
}

const tail = trace.slice(-30);
const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
const steadyYaw = mean(tail.map((s) => Math.abs(s.yawRateDegS)));
const steadyRoll = mean(tail.map((s) => Math.abs(s.rollDeg)));
const steadyLatG = mean(tail.map((s) => Math.abs(s.lateralG)));
const at50ms = trace[Math.round(0.05 / dt) - 1];
const at250ms = trace[Math.round(0.25 / dt) - 1];
const finalTurnState = steeringSim.vehicle.getState();
const finalLoads = axleFz(finalTurnState);

assert(steadyYaw > 2, `steering step produced too little yaw: ${steadyYaw.toFixed(2)} deg/s`);
assert(steadyRoll > 0.05, `steering step produced too little roll: ${steadyRoll.toFixed(3)} deg`);
assert(steadyLatG > 0.05, `steering step produced too little lateral G: ${steadyLatG.toFixed(3)} g`);
assert(Math.abs(at50ms.yawRateDegS) < steadyYaw * 0.75,
  `yaw established too immediately: 50ms=${at50ms.yawRateDegS.toFixed(2)} steady=${steadyYaw.toFixed(2)} deg/s`);
assert(Math.abs(at50ms.rollDeg) < steadyRoll * 0.55,
  `roll established too immediately: 50ms=${at50ms.rollDeg.toFixed(3)} steady=${steadyRoll.toFixed(3)} deg`);
assert(Math.abs(at250ms.yawRateDegS) > Math.abs(at50ms.yawRateDegS),
  'yaw rate should build after the initial tire transient');
assert(finalLoads.right > finalLoads.left,
  `left-turn outside/right tires must carry more load: L=${finalLoads.left.toFixed(0)} R=${finalLoads.right.toFixed(0)} N`);

const releaseYawStart = Math.abs(finalTurnState.yawRate);
for (let step = 0; step < 180; step++) steeringSim.stepExplicit(neutral, 1);
const releasedState = assertFiniteState(steeringSim, 'steering release');
assert(Math.abs(releasedState.yawRate) < releaseYawStart * 0.30,
  `yaw rate failed to decay after steering release: start=${(releaseYawStart * radToDeg).toFixed(1)} final=${(Math.abs(releasedState.yawRate) * radToDeg).toFixed(1)} deg/s`);

// Emit graph-ready data in CI logs. Downsample to 20 Hz to keep logs readable.
console.log('M5_CHASSIS_TRACE_CSV_BEGIN');
console.log('time_s,steer_deg,front_slip_deg,lateral_g,yaw_rate_deg_s,roll_deg,fz_fl_n,fz_fr_n,fz_rl_n,fz_rr_n');
for (let i = 0; i < trace.length; i += 6) {
  const s = trace[i];
  console.log([
    s.t.toFixed(4), s.steerDeg.toFixed(4), s.frontSlipDeg.toFixed(4),
    s.lateralG.toFixed(5), s.yawRateDegS.toFixed(4), s.rollDeg.toFixed(4),
    ...s.fz.map((value) => value.toFixed(1)),
  ].join(','));
}
console.log('M5_CHASSIS_TRACE_CSV_END');

// -----------------------------------------------------------------------------
// 3. 50 km/h steady-state circle
// -----------------------------------------------------------------------------
const circleSim = makeMovingSim(50 / 3.6);
const circleInput = steerForCenterAngleDeg(5.0);
for (let step = 0; step < 480; step++) circleSim.stepExplicit({ ...neutral, steer: circleInput }, 1);
const circleState = assertFiniteState(circleSim, '50 km/h steady circle');
const circleRadiusM = Math.abs(circleState.yawRate) > 1e-4
  ? circleState.speedMs / Math.abs(circleState.yawRate)
  : Number.POSITIVE_INFINITY;
assert(circleRadiusM > 8 && circleRadiusM < 80,
  `50 km/h steady-state circle radius implausible: ${circleRadiusM.toFixed(1)} m`);
assert(circleState.airborneCount === 0, '50 km/h steady-state circle lifted a wheel off the road');

// -----------------------------------------------------------------------------
// 4. 80-120 km/h lane-change envelope
// -----------------------------------------------------------------------------
const laneChangeSim = makeMovingSim(100 / 3.6);
const laneSteer = steerForCenterAngleDeg(2.8);
let maxLaneYawRate = 0;
for (let step = 0; step < 60; step++) {
  const state = laneChangeSim.stepExplicit({ ...neutral, steer: laneSteer }, 1);
  maxLaneYawRate = Math.max(maxLaneYawRate, Math.abs(state.yawRate));
}
for (let step = 0; step < 120; step++) {
  const state = laneChangeSim.stepExplicit({ ...neutral, steer: -laneSteer }, 1);
  maxLaneYawRate = Math.max(maxLaneYawRate, Math.abs(state.yawRate));
}
for (let step = 0; step < 120; step++) laneChangeSim.stepExplicit(neutral, 1);
const laneState = assertFiniteState(laneChangeSim, '100 km/h lane change');
assert(maxLaneYawRate < 1.6, `lane-change yaw rate diverged: ${(maxLaneYawRate * radToDeg).toFixed(1)} deg/s`);
assert(Math.abs(laneState.yawRate) < maxLaneYawRate * 0.35,
  'lane-change yaw motion did not settle after steering returned to center');

// -----------------------------------------------------------------------------
// 5. Slalom: repeated sign reversal must remain bounded and mirrored
// -----------------------------------------------------------------------------
const slalomSim = makeMovingSim(80 / 3.6);
const slalomSteer = steerForCenterAngleDeg(2.5);
let maxSlalomRoll = 0;
let maxSlalomYaw = 0;
for (let step = 0; step < 480; step++) {
  const phase = Math.floor(step / 60) % 2 === 0 ? 1 : -1;
  const state = slalomSim.stepExplicit({ ...neutral, steer: slalomSteer * phase }, 1);
  maxSlalomRoll = Math.max(maxSlalomRoll, Math.abs(state.roll));
  maxSlalomYaw = Math.max(maxSlalomYaw, Math.abs(state.yawRate));
}
const slalomState = assertFiniteState(slalomSim, '80 km/h slalom');
assert(maxSlalomRoll < 0.20, `slalom roll exceeded 11.5 deg: ${(maxSlalomRoll * radToDeg).toFixed(1)} deg`);
assert(maxSlalomYaw < 1.8, `slalom yaw exceeded bounded envelope: ${(maxSlalomYaw * radToDeg).toFixed(1)} deg/s`);
assert(slalomState.airborneCount === 0, 'slalom ended with airborne wheels');

// -----------------------------------------------------------------------------
// 6. Lift-off mid-corner and trail braking
// -----------------------------------------------------------------------------
const liftOffSim = makeMovingSim(22);
const cornerSteer = steerForCenterAngleDeg(3.2);
for (let step = 0; step < 180; step++) {
  liftOffSim.stepExplicit({ ...neutral, throttle: 0.18, steer: cornerSteer }, 1);
}
const beforeLift = liftOffSim.vehicle.getState();
for (let step = 0; step < 90; step++) {
  liftOffSim.stepExplicit({ ...neutral, steer: cornerSteer }, 1);
}
const afterLift = assertFiniteState(liftOffSim, 'lift-off mid-corner');
assert(Math.abs(afterLift.yawRate - beforeLift.yawRate) < 1.2,
  'lift-off created a nonphysical instantaneous yaw-rate jump');

const trailBrakeSim = makeMovingSim(22);
for (let step = 0; step < 160; step++) trailBrakeSim.stepExplicit({ ...neutral, steer: cornerSteer }, 1);
const beforeTrail = axleFz(trailBrakeSim.vehicle.getState());
for (let step = 0; step < 60; step++) {
  trailBrakeSim.stepExplicit({ ...neutral, steer: cornerSteer, brake: 0.30 }, 1);
}
const trailState = assertFiniteState(trailBrakeSim, 'trail braking');
const afterTrail = axleFz(trailState);
assert(afterTrail.front > beforeTrail.front * 0.95,
  `trail braking unexpectedly unloaded the front axle: before=${beforeTrail.front.toFixed(0)} after=${afterTrail.front.toFixed(0)} N`);

// -----------------------------------------------------------------------------
// 7. Braking pitch and acceleration squat must develop over time, not teleport
// -----------------------------------------------------------------------------
const brakeSim = makeMovingSim(25);
const brakeBaselinePitch = brakeSim.vehicle.getState().pitch;
const brakePitch: number[] = [];
for (let step = 0; step < 90; step++) {
  const state = brakeSim.stepExplicit({ ...neutral, brake: 0.60 }, 1);
  brakePitch.push(Math.abs(state.pitch - brakeBaselinePitch));
}
assertFiniteState(brakeSim, 'braking pitch');
const maxBrakePitch = Math.max(...brakePitch);
assert(maxBrakePitch > 0.001, `braking generated no measurable pitch change: ${maxBrakePitch}`);
assert(brakePitch[0] < maxBrakePitch * 0.20,
  `braking pitch change teleported on first 120 Hz step: first=${brakePitch[0]} max=${maxBrakePitch} baseline=${brakeBaselinePitch}`);

const accelSim = makeMovingSim(8);
const accelBaselinePitch = accelSim.vehicle.getState().pitch;
const accelPitch: number[] = [];
for (let step = 0; step < 120; step++) {
  const state = accelSim.stepExplicit({ ...neutral, throttle: 0.70 }, 1);
  accelPitch.push(Math.abs(state.pitch - accelBaselinePitch));
}
assertFiniteState(accelSim, 'acceleration squat');
const maxAccelPitch = Math.max(...accelPitch);
assert(maxAccelPitch > 0.0003, `acceleration generated no measurable squat/pitch change: ${maxAccelPitch}`);
assert(accelPitch[0] < maxAccelPitch * 0.25,
  `acceleration squat/pitch change teleported on first 120 Hz step: first=${accelPitch[0]} max=${maxAccelPitch} baseline=${accelBaselinePitch}`);

// -----------------------------------------------------------------------------
// 8. Spin recovery: chassis rotational energy must remain finite and tire forces
// must be able to arrest yaw without a hidden angular-velocity clamp.
// -----------------------------------------------------------------------------
const spinSim = makeMovingSim(18);
spinSim.vehicle.rigidBody.angularVelocity = PhysicsMath.vec3(0, 0.65, 0);
const initialSpinRate = Math.abs(spinSim.vehicle.getState().yawRate);
for (let step = 0; step < 300; step++) spinSim.stepExplicit(neutral, 1);
const recoveredSpin = assertFiniteState(spinSim, 'spin recovery');
assert(Math.abs(recoveredSpin.yawRate) < initialSpinRate,
  `tire/chassis system failed to dissipate yaw after spin: initial=${(initialSpinRate * radToDeg).toFixed(1)} final=${(Math.abs(recoveredSpin.yawRate) * radToDeg).toFixed(1)} deg/s`);

console.log(JSON.stringify({
  massKg: m5Props.mass,
  cgHeightM: config.centerOfGravityHeight,
  cgToFrontAxleM: m5Props.cgToFrontAxle,
  cgToRearAxleM: m5Props.cgToRearAxle,
  frontTrackM: m5Props.frontTrack,
  rearTrackM: m5Props.rearTrack,
  inertiaKgM2: {
    pitch: m5Props.inertia.x,
    yaw: m5Props.inertia.y,
    roll: m5Props.inertia.z,
  },
  steeringStep: { steadyYawDegS: steadyYaw, steadyRollDeg: steadyRoll, steadyLatG },
  circle50Kmh: { radiusM: circleRadiusM, yawRateDegS: circleState.yawRate * radToDeg },
  laneChange100Kmh: { maxYawRateDegS: maxLaneYawRate * radToDeg },
  slalom80Kmh: { maxYawRateDegS: maxSlalomYaw * radToDeg, maxRollDeg: maxSlalomRoll * radToDeg },
  braking: {
    baselinePitchDeg: brakeBaselinePitch * radToDeg,
    maxPitchChangeDeg: maxBrakePitch * radToDeg,
  },
  acceleration: {
    baselinePitchDeg: accelBaselinePitch * radToDeg,
    maxPitchChangeDeg: maxAccelPitch * radToDeg,
  },
  spinRecovery: {
    initialYawRateDegS: initialSpinRate * radToDeg,
    finalYawRateDegS: Math.abs(recoveredSpin.yawRate) * radToDeg,
  },
  verticalLoadN: { steeringStepTotal: totalFz(finalTurnState) },
}, null, 2));

console.log('M5ChassisDynamicsTests: PASS');

import assert from 'node:assert/strict';
import { Simulation } from '../Simulation';
import { DEFAULT_VEHICLE_CONFIG } from '../vehiclePresets';
import { BMW_M5_2025_OVERRIDES } from '../m5G90';
import { PhysicsMath } from '../math/PhysicsMath';
import { deriveChassisMassProperties } from '../ChassisMassProperties';

const dt = 1 / 120;
const DEG = 180 / Math.PI;
const neutral = { throttle: 0, brake: 0, steer: 0, handbrake: false, shiftUp: false, shiftDown: false };
const sideslipDeg = (sim: Simulation) => {
  const v = sim.vehicle.rigidBody.getLocalVelocity();
  return Math.atan2(v.x, Math.max(0.1, Math.abs(v.z))) * DEG;
};
function sample(sim: Simulation, t: number, driverInput: number) {
  const s = sim.vehicle.getState();
  const avg = (a: number, b: number) => (a + b) * 0.5;
  return {
    t,
    speedKmh: s.speedKmh,
    yawRateDegS: s.yawRate * DEG,
    sideslipDeg: sideslipDeg(sim),
    pitchDeg: s.pitch * DEG,
    rollDeg: s.roll * DEG,
    driverInput,
    steerDeg: s.actualSteerAngle * DEG,
    frontSlipDeg: avg(s.wheels[0].slipAngle, s.wheels[1].slipAngle) * DEG,
    rearSlipDeg: avg(s.wheels[2].slipAngle, s.wheels[3].slipAngle) * DEG,
    frontKappa: avg(s.wheels[0].slipRatio, s.wheels[1].slipRatio),
    rearKappa: avg(s.wheels[2].slipRatio, s.wheels[3].slipRatio),
    frontFyN: s.wheels[0].forceVectorLat + s.wheels[1].forceVectorLat,
    rearFyN: s.wheels[2].forceVectorLat + s.wheels[3].forceVectorLat,
    frontFzN: s.wheels[0].forceVectorNorm + s.wheels[1].forceVectorNorm,
    rearFzN: s.wheels[2].forceVectorNorm + s.wheels[3].forceVectorNorm,
    leftFzN: s.wheels[0].forceVectorNorm + s.wheels[2].forceVectorNorm,
    rightFzN: s.wheels[1].forceVectorNorm + s.wheels[3].forceVectorNorm,
  };
}
function makeOversteeringM5() {
  const config = { ...DEFAULT_VEHICLE_CONFIG, ...BMW_M5_2025_OVERRIDES, absMode: 'OFF', tcsMode: 'OFF' } as any;
  assert.equal(config.absMode, 'OFF');
  assert.equal(config.tcsMode, 'OFF');
  assert.equal(config.driftAssist ?? 0, 0, 'recovery test must not enable drift assist');
  const sim = new Simulation(config);
  sim.reset(0, 0, 0);

  // Protect the chassis physics itself. Recovery must not be made easy by giving a
  // 2.38-ton, 3.00-m-wheelbase sedan the yaw inertia of a much shorter object.
  // The current chassis model derives Iz from both longitudinal axle/CG distribution
  // and transverse mass width. Do not regress this test to the old m*lf*lr-only
  // approximation, which implicitly concentrates all mass on the vehicle centerline.
  const expectedMassProperties = deriveChassisMassProperties(config);
  const expectedYawInertia = expectedMassProperties.inertia.y;
  const initialYawInertia = sim.vehicle.rigidBody.config.inertia.y;
  assert(
    Math.abs(initialYawInertia - expectedYawInertia) / expectedYawInertia < 1e-9,
    `M5 yaw inertia does not match derived mass-properties model at construction: actual=${initialYawInertia.toFixed(1)}, expected=${expectedYawInertia.toFixed(1)} kg*m^2`
  );
  assert(
    initialYawInertia > 4800 && initialYawInertia < 6500,
    `M5 yaw inertia outside plausible heavy-sedan guardrail: ${initialYawInertia.toFixed(1)} kg*m^2`
  );

  // Runtime preset/tuning changes used to recompute the old low yaw inertia even
  // when construction was correct. Reapply the exact same M5 config and prove the
  // rotational properties remain identical before beginning the recovery exercise.
  sim.setConfig(config);
  const reconfiguredYawInertia = sim.vehicle.rigidBody.config.inertia.y;
  assert(
    Math.abs(reconfiguredYawInertia - expectedYawInertia) / expectedYawInertia < 1e-9,
    `M5 runtime reconfiguration changed yaw inertia: actual=${reconfiguredYawInertia.toFixed(1)}, expected=${expectedYawInertia.toFixed(1)} kg*m^2`
  );
  assert.equal(reconfiguredYawInertia, initialYawInertia, 'M5 yaw inertia must survive identical runtime config reapply');

  for (let i = 0; i < 300; i++) sim.stepExplicit(neutral, 1);
  const speedMs = 25;
  sim.vehicle.rigidBody.velocity = PhysicsMath.vec3(0, 0, speedMs);
  sim.vehicle.wheels.forEach((wheel) => wheel.reset(speedMs));
  for (let i = 0; i < 60; i++) sim.stepExplicit(neutral, 1);
  for (let i = 0; i < 90; i++) sim.stepExplicit({ ...neutral, steer: 0.18 }, 1);

  // Use a fixed input history for the induced slide. The former yaw/slip-triggered
  // loop made the handbrake duration depend on the physics under test: a small shift
  // in rear-slip timing could add several 120 Hz handbrake samples and make recovery
  // start from a materially harsher state. The severity guards below still require
  // >45 deg/s yaw, >10 deg rear slip and >0.5 rear kappa, so this does not make the
  // recovery test easier; it makes baseline/candidate starting states comparable.
  const inductionSteps = Math.round(0.30 / dt);
  const inductionTail: ReturnType<typeof sample>[] = [];
  for (let i = 0; i < inductionSteps; i++) {
    sim.stepExplicit({ ...neutral, steer: 0.18, handbrake: true }, 1);
    inductionTail.push(sample(sim, (i + 1) * dt, 0.18));
    if (inductionTail.length > 10) inductionTail.shift();
  }
  return { sim, inductionSec: inductionSteps * dt, yawInertiaKgM2: reconfiguredYawInertia, inductionTail };
}
function runDigitalDriverRecovery() {
  const { sim, inductionSec, yawInertiaKgM2, inductionTail } = makeOversteeringM5();
  sim.resetDigitalSteeringInput(0.18);
  let released = false;
  let releaseTimeSec: number | null = null;
  let peakCounterInput = 0;
  let peakCounterSteerDeg = 0;
  const samples = [sample(sim, 0, sim.digitalSteeringInput)];
  const wanted = new Set([0.10, 0.25, 0.50, 0.75, 1.00, 1.50].map((t) => Math.round(t / dt)));
  const totalSteps = Math.round(1.5 / dt);
  for (let i = 1; i <= totalSteps; i++) {
    const stateBefore = sim.vehicle.getState();
    const yawDegS = stateBefore.yawRate * DEG;
    if (!released && yawDegS <= 8) { released = true; releaseTimeSec = i * dt; }
    const direction: -1 | 0 = released ? 0 : -1;

    const state = sim.stepExplicit(
      { ...neutral, steer: 0, digitalSteerDirection: direction },
      1
    );
    const digitalInput = sim.digitalSteeringInput;
    peakCounterInput = Math.max(peakCounterInput, -digitalInput);
    peakCounterSteerDeg = Math.max(peakCounterSteerDeg, -state.actualSteerAngle * DEG);
    if (wanted.has(i)) samples.push(sample(sim, i * dt, digitalInput));
  }
  return { inductionSec, yawInertiaKgM2, releaseTimeSec, peakCounterInput, peakCounterSteerDeg, inductionTail, samples };
}
const result = runDigitalDriverRecovery();
const at = (seconds: number) => {
  const found = result.samples.find((s) => Math.abs(s.t - seconds) < dt * 0.51);
  assert(found, `missing ${seconds}s recovery sample`);
  return found;
};
const start = at(0), t100 = at(0.10), t250 = at(0.25), t500 = at(0.50), t750 = at(0.75), t1000 = at(1.00);
console.log(JSON.stringify({ scenario: 'M5 oversteer catch using real keyboard/touch steering path; ABS/TCS OFF', ...result }, null, 2));

// The heavier, physically plausible yaw inertia deliberately lowers the initial yaw
// acceleration versus the old ~2.58k kg*m^2 chassis. The test still begins from a
// severe, unmistakable rear slide rather than requiring the old artificially high
// spin rate.
assert(start.yawRateDegS > 45, `induced yaw is too mild: ${start.yawRateDegS.toFixed(1)} deg/s`);
assert(Math.abs(start.rearSlipDeg) > 10, `rear tire is not genuinely saturated: ${start.rearSlipDeg.toFixed(1)} deg`);
assert(Math.abs(start.rearKappa) > 0.5, `rear wheel lock trigger is too mild: kappa=${start.rearKappa.toFixed(3)}`);

// Rear traction must come back because slip comes back into the tire envelope, not
// because of ESC, TCS, yaw damping, or injected grip.
assert(Math.abs(t100.rearKappa) < 0.05, `rear longitudinal slip did not recover: ${t100.rearKappa.toFixed(3)}`);
assert(Math.abs(t100.rearFyN) > 7000, `rear lateral force did not recover: ${t100.rearFyN.toFixed(0)} N`);

// The driver must have access to real opposite lock, then be able to unwind it.
assert(result.peakCounterInput > 0.8, `digital input still withholds opposite lock: ${result.peakCounterInput.toFixed(3)}`);
assert(result.peakCounterSteerDeg > 20, `physical countersteer authority is too small: ${result.peakCounterSteerDeg.toFixed(1)} deg`);
assert(result.releaseTimeSec !== null && result.releaseTimeSec < 0.40, `driver could not arrest yaw promptly; release=${result.releaseTimeSec}`);

// A heavy chassis is allowed to carry rotational momentum through an opposite-yaw
// unwind transient. What is not allowed is continued runaway rotation after the
// driver has caught the rear. Judge recovery relative to the induced yaw, then
// require the car to settle tightly by 0.75-1.0 s. The 750 ms absolute bound is a
// regression guardrail rather than published M5 data; 6 deg/s still requires more
// than 88% of the induced 53 deg/s yaw to be gone before the 1 s near-zero check.
assert(Math.abs(t250.yawRateDegS) < Math.abs(start.yawRateDegS) * 0.30, `countersteer did not arrest yaw by 250 ms: ${t250.yawRateDegS.toFixed(1)} deg/s`);
assert(Math.abs(t500.yawRateDegS) < Math.abs(start.yawRateDegS) * 0.60, `opposite-yaw unwind became a snap spin: ${t500.yawRateDegS.toFixed(1)} deg/s`);
assert(Math.abs(t750.yawRateDegS) < 6, `yaw not under control by 750 ms: ${t750.yawRateDegS.toFixed(1)} deg/s`);
assert(Math.abs(t750.sideslipDeg) < 3, `body sideslip not caught by 750 ms: ${t750.sideslipDeg.toFixed(1)} deg`);
assert(Math.abs(t1000.yawRateDegS) < 2, `yaw did not settle by 1 s: ${t1000.yawRateDegS.toFixed(1)} deg/s`);
assert(Math.abs(t1000.sideslipDeg) < 2, `sideslip did not settle by 1 s: ${t1000.sideslipDeg.toFixed(1)} deg`);
console.log('M5OversteerRecoveryTests: PASS');

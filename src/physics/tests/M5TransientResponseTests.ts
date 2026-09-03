import { Simulation } from '../Simulation';
import { DEFAULT_VEHICLE_CONFIG } from '../vehiclePresets';
import { BMW_M5_2025_OVERRIDES } from '../m5G90';
import { PhysicsMath } from '../math/PhysicsMath';

const assert = (condition: boolean, message: string) => {
  if (!condition) throw new Error(message);
};

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
const speedMs = 20; // 72 km/h

// Transient calibration must be tied to a physical road-wheel request, not a
// normalized controller number. The old speed-dependent rack cap made steer=0.14
// correspond to about 3.2 deg center steer at 72 km/h. Preserve that physical
// maneuver now that the rack correctly retains full authority at speed.
const targetCenterSteerRad = 3.2 * Math.PI / 180;
const steerInput = targetCenterSteerRad / config.maxSteerAngle;

const sim = new Simulation(config);
sim.reset(0, 0, 0);

for (let i = 0; i < 300; i++) sim.stepExplicit(neutral, 1);
sim.vehicle.rigidBody.velocity = PhysicsMath.vec3(0, 0, speedMs);
sim.vehicle.wheels.forEach((wheel) => wheel.reset(speedMs));
for (let i = 0; i < 90; i++) sim.stepExplicit(neutral, 1);

type Sample = {
  t: number;
  frontFyMagnitude: number;
  frontFySigned: number;
  outsideTravelDelta: number;
  roll: number;
  yawRate: number;
};

const sampleState = (t: number): Sample => {
  const state = sim.vehicle.getState();
  const fyFL = state.wheels[0].forceVectorLat;
  const fyFR = state.wheels[1].forceVectorLat;
  const outsideTravelDelta =
    0.5 * (state.wheels[1].verticalTravelM + state.wheels[3].verticalTravelM) -
    0.5 * (state.wheels[0].verticalTravelM + state.wheels[2].verticalTravelM);
  return {
    t,
    frontFyMagnitude: Math.abs(fyFL) + Math.abs(fyFR),
    frontFySigned: fyFL + fyFR,
    outsideTravelDelta,
    roll: Math.abs(state.roll),
    yawRate: Math.abs(state.yawRate),
  };
};

const turnIn: Sample[] = [];
for (let step = 0; step < 180; step++) {
  sim.stepExplicit({ ...neutral, steer: steerInput }, 1);
  turnIn.push(sampleState((step + 1) * dt));
}

const tail = turnIn.slice(-30);
const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
const steady = {
  frontFyMagnitude: mean(tail.map((s) => s.frontFyMagnitude)),
  frontFySigned: mean(tail.map((s) => s.frontFySigned)),
  outsideTravelDelta: mean(tail.map((s) => s.outsideTravelDelta)),
  roll: mean(tail.map((s) => s.roll)),
  yawRate: mean(tail.map((s) => s.yawRate)),
};

const firstTimeAtFraction = (
  samples: Sample[],
  key: keyof Pick<Sample, 'frontFyMagnitude' | 'outsideTravelDelta' | 'roll'>,
  target: number,
  fraction: number
): number => {
  const threshold = Math.abs(target) * fraction;
  const hit = samples.find((s) => Math.abs(s[key]) >= threshold);
  return hit?.t ?? Number.POSITIVE_INFINITY;
};

const fractionAt = (
  samples: Sample[],
  key: keyof Pick<Sample, 'frontFyMagnitude' | 'outsideTravelDelta' | 'roll'>,
  target: number,
  timeSec: number
): number => {
  const index = Math.max(0, Math.min(samples.length - 1, Math.round(timeSec / dt) - 1));
  return Math.abs(samples[index][key]) / Math.max(1e-9, Math.abs(target));
};

const sampleAt = (samples: Sample[], timeSec: number): Sample => {
  const index = Math.max(0, Math.min(samples.length - 1, Math.round(timeSec / dt) - 1));
  return samples[index];
};

const turnInTiming = {
  tire25: firstTimeAtFraction(turnIn, 'frontFyMagnitude', steady.frontFyMagnitude, 0.25),
  tire50: firstTimeAtFraction(turnIn, 'frontFyMagnitude', steady.frontFyMagnitude, 0.50),
  travel25: firstTimeAtFraction(turnIn, 'outsideTravelDelta', steady.outsideTravelDelta, 0.25),
  travel50: firstTimeAtFraction(turnIn, 'outsideTravelDelta', steady.outsideTravelDelta, 0.50),
  roll25: firstTimeAtFraction(turnIn, 'roll', steady.roll, 0.25),
  roll50: firstTimeAtFraction(turnIn, 'roll', steady.roll, 0.50),
};

const turnInFractions = {
  at50ms: {
    tire: fractionAt(turnIn, 'frontFyMagnitude', steady.frontFyMagnitude, 0.05),
    travel: fractionAt(turnIn, 'outsideTravelDelta', steady.outsideTravelDelta, 0.05),
    roll: fractionAt(turnIn, 'roll', steady.roll, 0.05),
  },
  at100ms: {
    tire: fractionAt(turnIn, 'frontFyMagnitude', steady.frontFyMagnitude, 0.10),
    travel: fractionAt(turnIn, 'outsideTravelDelta', steady.outsideTravelDelta, 0.10),
    roll: fractionAt(turnIn, 'roll', steady.roll, 0.10),
  },
  at250ms: {
    tire: fractionAt(turnIn, 'frontFyMagnitude', steady.frontFyMagnitude, 0.25),
    travel: fractionAt(turnIn, 'outsideTravelDelta', steady.outsideTravelDelta, 0.25),
    roll: fractionAt(turnIn, 'roll', steady.roll, 0.25),
  },
};

const release: Sample[] = [];
for (let step = 0; step < 180; step++) {
  sim.stepExplicit(neutral, 1);
  release.push(sampleState((step + 1) * dt));
}

const steadyForceSign = Math.sign(steady.frontFySigned) || 1;
const signedForceRatio = (sample: Sample) =>
  (sample.frontFySigned * steadyForceSign) / Math.max(1e-9, Math.abs(steady.frontFySigned));
const residualCorneringForceFraction = (sample: Sample) => Math.max(0, signedForceRatio(sample));
const firstCorrectiveForceSample = release.find((s) => signedForceRatio(s) <= 0);
const firstCorrectiveForceTimeSec = firstCorrectiveForceSample?.t ?? Number.POSITIVE_INFINITY;

const releaseSnapshot = (timeSec: number) => {
  const s = sampleAt(release, timeSec);
  return {
    residualCorneringTire: residualCorneringForceFraction(s),
    signedTire: signedForceRatio(s),
    tireMagnitude: s.frontFyMagnitude / Math.max(1e-9, steady.frontFyMagnitude),
    travel: Math.abs(s.outsideTravelDelta) / Math.max(1e-9, Math.abs(steady.outsideTravelDelta)),
    roll: s.roll / Math.max(1e-9, steady.roll),
    yaw: s.yawRate / Math.max(1e-9, steady.yawRate),
  };
};

const releaseFractions = {
  at50ms: releaseSnapshot(0.05),
  at100ms: releaseSnapshot(0.10),
  at250ms: releaseSnapshot(0.25),
  at500ms: releaseSnapshot(0.50),
  at750ms: releaseSnapshot(0.75),
};

const maxReleaseRoll = Math.max(...release.map((s) => s.roll));
const finalReleaseRoll = mean(release.slice(-30).map((s) => s.roll));

console.log(JSON.stringify({
  speedKmh: speedMs * 3.6,
  targetCenterSteerDeg: targetCenterSteerRad * 180 / Math.PI,
  steerInput,
  yawInertiaKgM2: sim.vehicle.rigidBody.config.inertia.y,
  steady: {
    frontFyN: steady.frontFyMagnitude,
    frontFySignedN: steady.frontFySigned,
    outsideTravelDeltaM: steady.outsideTravelDelta,
    rollDeg: steady.roll * 180 / Math.PI,
    yawRateDegS: steady.yawRate * 180 / Math.PI,
  },
  turnInTimingSec: turnInTiming,
  turnInFractions,
  release: {
    firstCorrectiveForceTimeSec,
    fractions: releaseFractions,
    maxRollDeg: maxReleaseRoll * 180 / Math.PI,
    finalRollDeg: finalReleaseRoll * 180 / Math.PI,
  },
}, null, 2));

assert(steady.frontFyMagnitude > 1500, `turn-in did not generate meaningful front lateral force: ${steady.frontFyMagnitude.toFixed(0)} N`);
assert(Math.abs(steady.outsideTravelDelta) > 0.001, 'turn-in did not generate measurable outside suspension compression');
assert(steady.roll > 0.002, `turn-in did not generate measurable body roll: ${(steady.roll * 180 / Math.PI).toFixed(3)} deg`);
assert(steady.yawRate > 0.03, 'turn-in did not generate meaningful yaw rate');

assert(
  turnInTiming.tire50 >= 0.016 && turnInTiming.tire50 <= 0.050,
  `front tires should build to 50% over a short carcass transient, got ${(turnInTiming.tire50 * 1000).toFixed(1)} ms`
);
assert(
  turnInTiming.tire50 < turnInTiming.roll50,
  `front tire force must lead chassis roll: tire50=${turnInTiming.tire50.toFixed(3)}s roll50=${turnInTiming.roll50.toFixed(3)}s`
);
assert(
  turnInFractions.at50ms.roll < 0.12,
  `body flops over too early: ${(turnInFractions.at50ms.roll * 100).toFixed(1)}% of steady roll at 50 ms`
);
assert(
  turnInFractions.at100ms.travel > 0.12 && turnInFractions.at100ms.travel < 0.45,
  `outside suspension should be actively loading, not settled, at 100 ms: ${(turnInFractions.at100ms.travel * 100).toFixed(1)}%`
);
assert(
  turnInFractions.at100ms.roll > 0.20 && turnInFractions.at100ms.roll < 0.45,
  `body should still be loading at 100 ms: ${(turnInFractions.at100ms.roll * 100).toFixed(1)}% of steady roll`
);

// These 250 ms bounds are sequencing guardrails, not published BMW measurements.
// They were originally locked to the pre-inertia branch itself. With the chassis now
// carrying a derived physical inertia tensor, require the suspension/body to be well
// into the settled cornering attitude while still allowing the extra rotational mass
// response we explicitly set out to model. The earlier 50/100 ms anti-flop checks and
// the release decay checks remain unchanged and prevent artificial sluggishness.
assert(
  turnInFractions.at250ms.travel > 0.70 && turnInFractions.at250ms.travel < 1.25,
  `outside suspension is not well into its cornering attitude by 250 ms: ${(turnInFractions.at250ms.travel * 100).toFixed(1)}%`
);
assert(
  turnInFractions.at250ms.roll > 0.70 && turnInFractions.at250ms.roll < 1.20,
  `body is not well into a controlled cornering attitude by 250 ms: ${(turnInFractions.at250ms.roll * 100).toFixed(1)}%`
);

// On release, distinguish the original cornering force from later corrective force.
// The original force must shed while the heavy chassis remains loaded; opposite tire
// force is allowed and expected as yaw/sideslip are physically arrested.
assert(
  releaseFractions.at50ms.residualCorneringTire < 0.55 && releaseFractions.at50ms.travel > 0.70 && releaseFractions.at50ms.roll > 0.65,
  `steering release sequence is wrong at 50 ms: residualTire=${releaseFractions.at50ms.residualCorneringTire.toFixed(2)} travel=${releaseFractions.at50ms.travel.toFixed(2)} roll=${releaseFractions.at50ms.roll.toFixed(2)}`
);
assert(
  firstCorrectiveForceTimeSec > 0.04 && firstCorrectiveForceTimeSec < 0.30,
  `front tire force did not transition through zero into corrective force naturally: ${firstCorrectiveForceTimeSec.toFixed(3)} s`
);
assert(
  releaseFractions.at250ms.tireMagnitude < 0.20,
  `front tire-force rebound is too large at 250 ms: magnitude=${releaseFractions.at250ms.tireMagnitude.toFixed(2)} signed=${releaseFractions.at250ms.signedTire.toFixed(2)}`
);
assert(
  releaseFractions.at250ms.yaw < 0.45,
  `yaw momentum did not unwind by 250 ms: ${(releaseFractions.at250ms.yaw * 100).toFixed(1)}% of steady yaw`
);
assert(
  releaseFractions.at750ms.roll < 0.20 && releaseFractions.at750ms.yaw < 0.20,
  `chassis did not settle after corrective phase: roll=${releaseFractions.at750ms.roll.toFixed(2)} yaw=${releaseFractions.at750ms.yaw.toFixed(2)}`
);
assert(finalReleaseRoll < steady.roll * 0.05, 'body retained roll after steering release');
assert(maxReleaseRoll < steady.roll * 1.20, 'steering release produced an excessive roll spike');

console.log('M5TransientResponseTests: PASS');

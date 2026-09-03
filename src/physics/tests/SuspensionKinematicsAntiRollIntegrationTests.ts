import assert from 'node:assert/strict';
import type { ControlInputs, VehicleConfig } from '../../types';
import { Simulation } from '../Simulation';
import { ProvingGroundSurfaceProvider } from '../SurfaceProvider';
import { DEFAULT_VEHICLE_CONFIG } from '../vehiclePresets';
import { BMW_M5_2025_OVERRIDES } from '../m5G90';
import { PhysicsMath } from '../math/PhysicsMath';

const DT = 1 / 120;
const START_SPEED_MS = 180 / 3.6;
const DEG = 180 / Math.PI;

const zeroInputs: ControlInputs = {
  throttle: 0,
  brake: 0,
  steer: 0,
  handbrake: false,
  shiftUp: false,
  shiftDown: false,
};

const config = {
  ...DEFAULT_VEHICLE_CONFIG,
  ...BMW_M5_2025_OVERRIDES,
  // Keep this test focused on the physical axle-local PR #18 bars.
  antiRollCrossCoupling: 0,
} as VehicleConfig;

const sim = new Simulation(config, new ProvingGroundSurfaceProvider());
sim.reset(0, 0, 0);
sim.vehicle.powertrain.isAutomatic = false;
sim.vehicle.powertrain.gear = 0;
sim.vehicle.rigidBody.velocity.z = START_SPEED_MS;
for (const wheel of sim.vehicle.wheels) {
  wheel.angularVelocity = START_SPEED_MS / config.wheelRadius;
}

// Let contact, unsprung masses, tire relaxation, and geometry state settle before
// introducing differential suspension travel.
for (let i = 0; i < 90; i++) sim.stepExplicit(zeroInputs, 1);

let peakLatG = 0;
let peakArbForceN = 0;
let peakFrontDifferentialTravelM = 0;
let peakRearDifferentialTravelM = 0;
let peakCamberMigrationDeg = 0;
let peakBumpSteerDeg = 0;
let peakBodyRiseM = 0;
let airborneSamples = 0;
const startBodyY = sim.vehicle.rigidBody.position.y;

const staticCamber = [
  Number((config as any).camberStaticFront ?? -1.5),
  Number((config as any).camberStaticFront ?? -1.5),
  Number((config as any).camberStaticRear ?? -1.2),
  Number((config as any).camberStaticRear ?? -1.2),
];

for (let step = 0; step < 120 * 2.4; step++) {
  const t = step * DT;
  // Smooth left/right maneuver: enough lateral load to exercise PR #18's bars and
  // enough suspension travel for camber gain + tie-rod bump steer to become visible.
  const steer = t < 0.8
    ? 0.07 * Math.sin(Math.PI * t / 0.8)
    : t < 1.6
      ? -0.07 * Math.sin(Math.PI * (t - 0.8) / 0.8)
      : 0;

  const state = sim.stepExplicit({ ...zeroInputs, steer }, 1);
  const susp = sim.vehicle.suspension.states;

  const frontDiff = susp[0].displacement - susp[1].displacement;
  const rearDiff = susp[2].displacement - susp[3].displacement;
  const frontArbNet = susp[0].antiRollBarForceN + susp[1].antiRollBarForceN;
  const rearArbNet = susp[2].antiRollBarForceN + susp[3].antiRollBarForceN;

  // Dynamic integration can directly observe conservation: the two axle-local
  // reactions must remain exactly equal/opposite and create no vertical bias.
  // The force-vs-differential-travel sign itself is now tested exactly at the
  // calculateAntiRollBarForces solver boundary in PhysicsConventionTests. Comparing
  // it here to post-step displacement is invalid because the chassis pose is
  // integrated after the bar force was evaluated.
  assert(Math.abs(frontArbNet) < 1e-6, `front ARB created net vertical bias: ${frontArbNet} N`);
  assert(Math.abs(rearArbNet) < 1e-6, `rear ARB created net vertical bias: ${rearArbNet} N`);

  peakLatG = Math.max(peakLatG, Math.abs(state.lateralG));
  peakArbForceN = Math.max(
    peakArbForceN,
    ...susp.map((corner) => Math.abs(corner.antiRollBarForceN))
  );
  peakFrontDifferentialTravelM = Math.max(peakFrontDifferentialTravelM, Math.abs(frontDiff));
  peakRearDifferentialTravelM = Math.max(peakRearDifferentialTravelM, Math.abs(rearDiff));
  peakBodyRiseM = Math.max(peakBodyRiseM, sim.vehicle.rigidBody.position.y - startBodyY);

  if (susp.some((corner) => corner.isAirborne)) airborneSamples++;

  state.wheels.forEach((wheelState, index) => {
    const kinematic = wheelState as any;
    const values = [
      wheelState.steerAngle,
      wheelState.camberAngleDeg,
      kinematic.bumpSteerDeg,
      kinematic.casterDeg,
      kinematic.kingpinInclinationDeg,
      kinematic.scrubRadiusM,
    ];
    for (const value of values) {
      assert(Number.isFinite(value), `wheel ${index} produced non-finite kinematic state: ${value}`);
    }

    // The adapter writes one authoritative solved camber into both tire/suspension
    // state and render/export state; they must not diverge under ARB-induced travel.
    assert(
      Math.abs(wheelState.camberAngleDeg - susp[index].dynamicCamberDeg) < 1e-9,
      `wheel ${index} render/tire camber diverged: ${wheelState.camberAngleDeg} vs ${susp[index].dynamicCamberDeg}`
    );

    const forward = kinematic.wheelForwardBody;
    const lateral = kinematic.wheelLateralBody;
    const up = kinematic.wheelUpBody;
    assert(forward && lateral && up, `wheel ${index} missing geometry-derived basis vectors`);
    assert(Math.abs(PhysicsMath.vec3Length(forward) - 1) < 1e-7, `wheel ${index} forward basis lost normalization`);
    assert(Math.abs(PhysicsMath.vec3Length(lateral) - 1) < 1e-7, `wheel ${index} lateral basis lost normalization`);
    assert(Math.abs(PhysicsMath.vec3Length(up) - 1) < 1e-7, `wheel ${index} up basis lost normalization`);
    assert(Math.abs(PhysicsMath.vec3Dot(forward, lateral)) < 1e-7, `wheel ${index} forward/lateral basis lost orthogonality`);

    peakCamberMigrationDeg = Math.max(
      peakCamberMigrationDeg,
      Math.abs(wheelState.camberAngleDeg - staticCamber[index])
    );
    peakBumpSteerDeg = Math.max(peakBumpSteerDeg, Math.abs(kinematic.bumpSteerDeg));
  });
}

const final = sim.vehicle.getState();

console.log(JSON.stringify({
  scenario: 'PR18 anti-roll bars + geometry-driven wheel pose integration at 180 km/h',
  peakLatG,
  peakArbForceN,
  peakFrontDifferentialTravelMm: peakFrontDifferentialTravelM * 1000,
  peakRearDifferentialTravelMm: peakRearDifferentialTravelM * 1000,
  peakCamberMigrationDeg,
  peakBumpSteerDeg,
  peakBodyRiseMm: peakBodyRiseM * 1000,
  airborneSamples,
  finalSpeedKmh: final.speedKmh,
  finalRollDeg: Math.abs(final.roll) * DEG,
}, null, 2));

// Make sure both systems were materially exercised rather than merely remaining finite.
assert(peakLatG > 0.55, `integration maneuver was too mild: ${peakLatG.toFixed(2)} g`);
assert(peakArbForceN > 300, `physical anti-roll bars were not materially exercised: ${peakArbForceN.toFixed(0)} N`);
assert(peakFrontDifferentialTravelM > 0.006, `front differential travel too small: ${(peakFrontDifferentialTravelM * 1000).toFixed(2)} mm`);
assert(peakCamberMigrationDeg > 0.15, `geometry camber did not respond materially: ${peakCamberMigrationDeg.toFixed(3)} deg`);
assert(peakBumpSteerDeg > 0.002, `tie-rod bump steer was never exercised: ${peakBumpSteerDeg.toFixed(4)} deg`);
assert(peakBumpSteerDeg < 0.8, `bump steer became excessive: ${peakBumpSteerDeg.toFixed(3)} deg`);

// Preserve the key PR #18 stability outcomes while geometry is active.
assert(airborneSamples === 0, `geometry + ARB integration created ${airborneSamples} airborne samples`);
assert(peakBodyRiseM < 0.06, `geometry + ARB integration jacked body ${(peakBodyRiseM * 1000).toFixed(1)} mm`);
assert(final.speedKmh > 120, `integration maneuver lost implausible speed: ${final.speedKmh.toFixed(1)} km/h`);

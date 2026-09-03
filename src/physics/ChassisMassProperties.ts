import { Vec3, PhysicsMath } from './math/PhysicsMath';

/**
 * Inputs used to derive the sprung-body principal inertia tensor from measurable
 * vehicle geometry and a small number of explicit mass-distribution assumptions.
 *
 * Body axes follow PHYSICS_CONVENTIONS.md:
 *   +X lateral (pitch axis), +Y up (yaw axis), +Z forward (roll axis).
 */
export interface ChassisMassPropertyInput {
  mass: number;
  wheelbase: number;
  weightDistributionFront: number;
  centerOfGravityHeight: number;
  trackWidth: number;
  trackWidthFront?: number;
  trackWidthRear?: number;

  /** Effective vertical depth of the non-battery sprung mass. */
  chassisMassHeight?: number;
  /** Explicit low-mounted battery mass. Zero for vehicles without one. */
  batteryMassKg?: number;
  /** Battery mass-center height above the road in meters. */
  batteryCgHeight?: number;
  /** Effective vertical battery-pack thickness in meters. */
  batteryPackThickness?: number;
}

export interface ChassisMassProperties {
  mass: number;
  cgToFrontAxle: number;
  cgToRearAxle: number;
  frontTrack: number;
  rearTrack: number;
  inertia: Vec3;
  secondMomentX: number;
  secondMomentY: number;
  secondMomentZ: number;
  remainingBodyCgHeight: number;
}

const finiteOr = (value: unknown, fallback: number): number =>
  Number.isFinite(Number(value)) ? Number(value) : fallback;

/**
 * Derive a diagonal principal inertia tensor from mass second moments.
 *
 * Longitudinal mass distribution is constrained by the measured static axle loads.
 * If a and b are the CG distances to the front and rear axles, a two-station mass
 * distribution that reproduces those axle loads has longitudinal variance a*b.
 * This retains the useful m*a*b road-car yaw relationship while also allowing the
 * finite lateral vehicle width to contribute to yaw inertia.
 *
 * Lateral mass is treated as distributed across the measured axle tracks rather
 * than concentrated at the tire centers, giving variance track^2/12 at each axle.
 *
 * Vertically, an optional low battery is modeled separately. The remaining body
 * mass center is solved from the first-moment balance so the configured vehicle CG
 * stays authoritative. No hidden roll/pitch/yaw multipliers are used.
 */
export function deriveChassisMassProperties(
  input: ChassisMassPropertyInput
): ChassisMassProperties {
  const mass = Math.max(1, finiteOr(input.mass, 1));
  const wheelbase = Math.max(0.25, finiteOr(input.wheelbase, 2.5));
  const frontWeightFraction = PhysicsMath.clamp(
    finiteOr(input.weightDistributionFront, 0.5),
    0.05,
    0.95
  );
  const rearWeightFraction = 1 - frontWeightFraction;
  const cgHeight = Math.max(0.05, finiteOr(input.centerOfGravityHeight, 0.45));

  const fallbackTrack = Math.max(0.4, finiteOr(input.trackWidth, 1.6));
  const frontTrack = Math.max(0.4, finiteOr(input.trackWidthFront, fallbackTrack));
  const rearTrack = Math.max(0.4, finiteOr(input.trackWidthRear, fallbackTrack));

  // Static-load geometry: front axle is +Z and rear axle is -Z.
  const cgToFrontAxle = wheelbase * rearWeightFraction;
  const cgToRearAxle = wheelbase * frontWeightFraction;

  // Longitudinal second moment (variance) about the configured CG.
  const secondMomentZ = cgToFrontAxle * cgToRearAxle;

  // Distributed lateral mass width. The front/rear weighting follows static mass.
  const secondMomentX =
    frontWeightFraction * (frontTrack * frontTrack) / 12 +
    rearWeightFraction * (rearTrack * rearTrack) / 12;

  const requestedBatteryMass = Math.max(0, finiteOr(input.batteryMassKg, 0));
  // Keep a nonzero remainder so the first-moment solution stays well-conditioned.
  const batteryMass = Math.min(requestedBatteryMass, mass * 0.70);
  const remainingMass = mass - batteryMass;

  const chassisMassHeight = Math.max(
    0.20,
    finiteOr(input.chassisMassHeight, Math.max(0.70, Math.min(1.10, cgHeight * 1.75)))
  );
  const batteryPackThickness = Math.max(0.02, finiteOr(input.batteryPackThickness, 0.14));
  const batteryCgHeight = Math.max(
    0.02,
    finiteOr(input.batteryCgHeight, Math.min(cgHeight, 0.24))
  );

  const batteryOffsetY = batteryCgHeight - cgHeight;
  // Solve the remaining body's vertical center from Σ(m_i * y_i) = 0 about the CG.
  const remainingBodyOffsetY =
    remainingMass > 1e-6 ? -(batteryMass * batteryOffsetY) / remainingMass : 0;
  const remainingBodyCgHeight = cgHeight + remainingBodyOffsetY;

  const remainingBodyOwnVarianceY = (chassisMassHeight * chassisMassHeight) / 12;
  const batteryOwnVarianceY = (batteryPackThickness * batteryPackThickness) / 12;
  const secondMomentY =
    (
      remainingMass * (remainingBodyOwnVarianceY + remainingBodyOffsetY * remainingBodyOffsetY) +
      batteryMass * (batteryOwnVarianceY + batteryOffsetY * batteryOffsetY)
    ) / mass;

  // Principal moments: I_axis = m * sum(variance perpendicular to that axis).
  const pitchInertia = mass * (secondMomentY + secondMomentZ); // about +X
  const yawInertia = mass * (secondMomentX + secondMomentZ); // about +Y
  const rollInertia = mass * (secondMomentX + secondMomentY); // about +Z

  return {
    mass,
    cgToFrontAxle,
    cgToRearAxle,
    frontTrack,
    rearTrack,
    inertia: PhysicsMath.vec3(pitchInertia, yawInertia, rollInertia),
    secondMomentX,
    secondMomentY,
    secondMomentZ,
    remainingBodyCgHeight,
  };
}

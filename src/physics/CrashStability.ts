import { PhysicsMath, type Vec3 } from './math/PhysicsMath';
import type { Vehicle } from './Vehicle';

export interface ChassisContactProbe {
  contactCount: number;
  maxPenetrationM: number;
  deepestNormal: Vec3;
  deepestArmWorld: Vec3;
  uprightness: number;
}

const SUPPORT_CLEARANCE_M = 0.012;

function collisionPointsBody(vehicle: Vehicle): Vec3[] {
  const cfg = vehicle.config;
  const halfWidth = Math.max(0.78, cfg.trackWidth * 0.56);
  const halfLength = Math.max(1.55, cfg.wheelbase * 0.78);

  // These shell dimensions were originally authored around the suspension-pickup
  // reference plane, which sits 0.35 m above the physical CG. RigidBody.position is
  // now the CG itself, so translate every probe upward by that body-space offset.
  // This preserves the real underbody/roof/sill locations without allowing the
  // crash stabilizer to mistake normal driving for continuous chassis scraping.
  const pickupHeightAboveCg = Math.max(
    0,
    Number((cfg as any).suspensionPickupHeightAboveCg ?? 0.35)
  );
  const lowerY = -Math.max(0.50, cfg.centerOfGravityHeight + 0.08) + pickupHeightAboveCg;
  const upperY = Math.max(0.68, cfg.centerOfGravityHeight + 0.20) + pickupHeightAboveCg;
  const sillY = -0.05 + pickupHeightAboveCg;

  const points: Vec3[] = [];
  for (const x of [-halfWidth, halfWidth]) {
    for (const z of [-halfLength, halfLength]) {
      points.push(PhysicsMath.vec3(x, lowerY, z));
      points.push(PhysicsMath.vec3(x, upperY, z));
    }
  }

  // Side-sill points catch the common spin -> curb -> side-impact case before the
  // vertical-only suspension solver is asked to support a nearly sideways chassis.
  for (const x of [-halfWidth, halfWidth]) {
    points.push(PhysicsMath.vec3(x, sillY, halfLength * 0.35));
    points.push(PhysicsMath.vec3(x, sillY, -halfLength * 0.35));
  }

  return points;
}

export function probeChassisContact(vehicle: Vehicle): ChassisContactProbe {
  const body = vehicle.rigidBody;
  const cgSurface = vehicle.surfaceProvider.sampleSurface(body.position.x, body.position.z);
  const bodyUp = PhysicsMath.quatRotateVec3(body.orientation, PhysicsMath.vec3(0, 1, 0));
  const uprightness = PhysicsMath.vec3Dot(bodyUp, cgSurface.normal);

  let contactCount = 0;
  let maxPenetrationM = 0;
  let deepestNormal = PhysicsMath.vec3(0, 1, 0);
  let deepestArmWorld = PhysicsMath.vec3();

  for (const pointBody of collisionPointsBody(vehicle)) {
    const armWorld = PhysicsMath.quatRotateVec3(body.orientation, pointBody);
    const pointWorld = PhysicsMath.vec3Add(body.position, armWorld);
    const surface = vehicle.surfaceProvider.sampleSurface(pointWorld.x, pointWorld.z);
    const penetration = surface.elevation + SUPPORT_CLEARANCE_M - pointWorld.y;
    if (penetration > 0) {
      contactCount++;
      if (penetration > maxPenetrationM) {
        maxPenetrationM = penetration;
        deepestNormal = surface.normal;
        deepestArmWorld = armWorld;
      }
    }
  }

  return {
    contactCount,
    maxPenetrationM,
    deepestNormal,
    deepestArmWorld,
    uprightness,
  };
}

/**
 * Post-step crash/contact projection for the chassis shell.
 *
 * Normal driving still uses the tire/suspension solver. This only becomes active
 * when the physical body/roof/side shell intersects the road. It prevents a wipeout
 * from letting the chassis pass through the ground while the four wheel hubs remain
 * constrained near the road, which is the source of the huge stored spring energy
 * and violent shaking seen after a rollover.
 */
export function stabilizeVehicleAfterImpact(vehicle: Vehicle, dt: number): ChassisContactProbe {
  const probe = probeChassisContact(vehicle);
  if (dt <= 0 || probe.contactCount === 0 || probe.maxPenetrationM <= 0) return probe;

  const body = vehicle.rigidBody;
  const normal = PhysicsMath.vec3Normalize(probe.deepestNormal);
  const correction = Math.min(0.30, probe.maxPenetrationM + 0.003);
  body.position = PhysicsMath.vec3Add(body.position, PhysicsMath.vec3Scale(normal, correction));

  const contactPointVelocity = PhysicsMath.vec3Add(
    body.velocity,
    PhysicsMath.vec3Cross(body.angularVelocity, probe.deepestArmWorld)
  );
  const normalVelocity = PhysicsMath.vec3Dot(contactPointVelocity, normal);
  const impactSpeed = Math.max(0, -normalVelocity);

  // Very low restitution for body-shell contact. Wheels/suspension provide the
  // compliant ride response; scraping the underbody, side or roof should dissipate
  // crash energy rather than bounce the car back into another solver explosion.
  if (normalVelocity < 0) {
    body.velocity = PhysicsMath.vec3Sub(
      body.velocity,
      PhysicsMath.vec3Scale(normal, normalVelocity * 0.96)
    );
  }

  const severity = PhysicsMath.clamp(
    impactSpeed / 5 + probe.maxPenetrationM / 0.06 + Math.max(0, 0.70 - Math.abs(probe.uprightness)) * 1.5,
    0.25,
    3.5
  );

  const normalComponent = PhysicsMath.vec3Scale(normal, PhysicsMath.vec3Dot(body.velocity, normal));
  const tangentVelocity = PhysicsMath.vec3Sub(body.velocity, normalComponent);
  const scrapeRate = 0.45 + severity * 1.25;
  const scrapeBlend = 1 - Math.exp(-scrapeRate * dt);
  body.velocity = PhysicsMath.vec3Sub(body.velocity, PhysicsMath.vec3Scale(tangentVelocity, scrapeBlend));

  const angularDampingRate = 3.5 + severity * 5.5;
  const angularScale = Math.exp(-angularDampingRate * dt);
  body.angularVelocity = PhysicsMath.vec3Scale(body.angularVelocity, angularScale);

  // Numerical ceiling only during body contact. 12 rad/s is already an extremely
  // violent tumble (~115 rpm) but keeps the fixed-step quaternion/unsprung system
  // out of non-physical angular-velocity runaway after a curb or barrier launch.
  const angularSpeed = PhysicsMath.vec3Length(body.angularVelocity);
  if (angularSpeed > 12) {
    body.angularVelocity = PhysicsMath.vec3Scale(body.angularVelocity, 12 / angularSpeed);
  }

  // A large body correction must not leave the unsprung masses carrying an old,
  // opposite vertical velocity for the next 120 Hz step. Blend only on severe body
  // contact so normal bump/kerb wheel-hop physics is untouched.
  if (severity > 1 || Math.abs(probe.uprightness) < 0.65) {
    const hubBlend = 1 - Math.exp(-(10 + severity * 8) * dt);
    for (const state of vehicle.suspension.states) {
      if (!Number.isFinite(state.hubVelocityWorldY)) continue;
      state.hubVelocityWorldY = PhysicsMath.lerp(
        state.hubVelocityWorldY,
        body.velocity.y,
        hubBlend
      );
      state.unsprungAccelerationMps2 = PhysicsMath.clamp(state.unsprungAccelerationMps2, -180, 180);
    }
  }

  return probeChassisContact(vehicle);
}

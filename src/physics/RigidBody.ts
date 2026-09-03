import { Vec3, Quat, PhysicsMath } from './math/PhysicsMath';

export interface RigidBodyConfig {
  mass: number;
  inertia: Vec3; // principal moments in body coordinates (kg*m^2)
  centerOfGravityHeight: number;
}

/**
 * Minimal deterministic 6-DOF rigid body used by the vehicle solver.
 * Linear state is stored in world space. Angular velocity is exposed in
 * world space, while integration is performed in the body's principal axes.
 */
export class RigidBody {
  public config: RigidBodyConfig;
  /**
   * Generalized mass for chassis heave. Planar translation keeps the complete
   * vehicle mass because the wheel assemblies are constrained to travel with the
   * chassis in X/Z; vertical wheel motion is an independent suspension coordinate.
   */
  public verticalMass: number;
  public position: Vec3;
  public velocity: Vec3 = PhysicsMath.vec3();
  public acceleration: Vec3 = PhysicsMath.vec3(); // body-local acceleration for telemetry
  public angularVelocity: Vec3 = PhysicsMath.vec3(); // world-space rad/s
  public angularAcceleration: Vec3 = PhysicsMath.vec3(); // body-local rad/s^2
  public orientation: Quat;

  private accumulatedForceWorld: Vec3 = PhysicsMath.vec3();
  private accumulatedTorqueWorld: Vec3 = PhysicsMath.vec3();

  constructor(config: RigidBodyConfig, position: Vec3 = PhysicsMath.vec3(), yaw: number = 0) {
    this.config = { ...config, inertia: PhysicsMath.vec3Clone(config.inertia) };
    this.verticalMass = config.mass;
    this.position = PhysicsMath.vec3Clone(position);
    this.orientation = PhysicsMath.quatFromEuler(0, yaw, 0);
  }

  public clearForces() {
    this.accumulatedForceWorld = PhysicsMath.vec3();
    this.accumulatedTorqueWorld = PhysicsMath.vec3();
  }

  public getEuler() {
    return PhysicsMath.quatToEuler(this.orientation);
  }

  public getLocalVelocity(): Vec3 {
    return PhysicsMath.quatInverseRotateVec3(this.orientation, this.velocity);
  }

  public getLocalAngularVelocity(): Vec3 {
    return PhysicsMath.quatInverseRotateVec3(this.orientation, this.angularVelocity);
  }

  /** Velocity of a body-local point, expressed in body coordinates. */
  public getPointVelocityBody(pointBody: Vec3): Vec3 {
    const vLocal = this.getLocalVelocity();
    const omegaLocal = this.getLocalAngularVelocity();
    return PhysicsMath.vec3Add(vLocal, PhysicsMath.vec3Cross(omegaLocal, pointBody));
  }

  public addWorldForce(forceWorld: Vec3) {
    this.accumulatedForceWorld = PhysicsMath.vec3Add(this.accumulatedForceWorld, forceWorld);
  }

  public addBodyForce(forceBody: Vec3) {
    this.addWorldForce(PhysicsMath.quatRotateVec3(this.orientation, forceBody));
  }

  public addWorldForceAtPoint(forceWorld: Vec3, pointWorld: Vec3) {
    this.addWorldForce(forceWorld);
    const armWorld = PhysicsMath.vec3Sub(pointWorld, this.position);
    this.accumulatedTorqueWorld = PhysicsMath.vec3Add(
      this.accumulatedTorqueWorld,
      PhysicsMath.vec3Cross(armWorld, forceWorld)
    );
  }

  /** Point is relative to the CG in body coordinates. */
  public addBodyForceAtPoint(forceBody: Vec3, pointBody: Vec3) {
    const forceWorld = PhysicsMath.quatRotateVec3(this.orientation, forceBody);
    const armWorld = PhysicsMath.quatRotateVec3(this.orientation, pointBody);
    this.addWorldForce(forceWorld);
    this.accumulatedTorqueWorld = PhysicsMath.vec3Add(
      this.accumulatedTorqueWorld,
      PhysicsMath.vec3Cross(armWorld, forceWorld)
    );
  }

  public addBodyTorque(torqueBody: Vec3) {
    const torqueWorld = PhysicsMath.quatRotateVec3(this.orientation, torqueBody);
    this.accumulatedTorqueWorld = PhysicsMath.vec3Add(this.accumulatedTorqueWorld, torqueWorld);
  }

  public integrate(dt: number) {
    if (dt <= 0) return;

    const mass = Math.max(1e-3, this.config.mass);
    const heaveMass = Math.max(1e-3, this.verticalMass);
    // This is the diagonal generalized-mass form of the reduced 14-DOF vehicle:
    // total vehicle mass in the constrained horizontal coordinates, sprung mass in
    // heave where the four wheel/hub masses are solved independently.
    const linearAccelWorld = PhysicsMath.vec3(
      this.accumulatedForceWorld.x / mass,
      this.accumulatedForceWorld.y / heaveMass,
      this.accumulatedForceWorld.z / mass
    );

    // Semi-implicit Euler gives much better stability for suspension systems.
    this.velocity = PhysicsMath.vec3Add(this.velocity, PhysicsMath.vec3Scale(linearAccelWorld, dt));
    this.position = PhysicsMath.vec3Add(this.position, PhysicsMath.vec3Scale(this.velocity, dt));
    this.acceleration = PhysicsMath.quatInverseRotateVec3(this.orientation, linearAccelWorld);

    // Euler's rotational equation in the body's principal inertia frame:
    // I*wDot = tau - w x (I*w)
    const torqueBody = PhysicsMath.quatInverseRotateVec3(this.orientation, this.accumulatedTorqueWorld);
    let omegaBody = this.getLocalAngularVelocity();
    const I = this.config.inertia;
    const iOmega = PhysicsMath.vec3(I.x * omegaBody.x, I.y * omegaBody.y, I.z * omegaBody.z);
    const gyroscopic = PhysicsMath.vec3Cross(omegaBody, iOmega);
    const effectiveTorque = PhysicsMath.vec3Sub(torqueBody, gyroscopic);

    const alphaBody = PhysicsMath.vec3(
      effectiveTorque.x / Math.max(1e-3, I.x),
      effectiveTorque.y / Math.max(1e-3, I.y),
      effectiveTorque.z / Math.max(1e-3, I.z)
    );
    this.angularAcceleration = alphaBody;
    omegaBody = PhysicsMath.vec3Add(omegaBody, PhysicsMath.vec3Scale(alphaBody, dt));

    // Quaternion derivative for body-frame angular velocity: qDot = 0.5 * q * [w, 0]
    const omegaQuat: Quat = { x: omegaBody.x, y: omegaBody.y, z: omegaBody.z, w: 0 };
    const qDot = PhysicsMath.quatMultiply(this.orientation, omegaQuat);
    this.orientation = PhysicsMath.quatNormalize({
      x: this.orientation.x + 0.5 * qDot.x * dt,
      y: this.orientation.y + 0.5 * qDot.y * dt,
      z: this.orientation.z + 0.5 * qDot.z * dt,
      w: this.orientation.w + 0.5 * qDot.w * dt,
    });

    this.angularVelocity = PhysicsMath.quatRotateVec3(this.orientation, omegaBody);
    this.clearForces();
  }
}

import { VehicleConfig, VehicleState, ControlInputs } from '../types';
import { Vehicle } from './Vehicle';
import { ISurfaceProvider } from './SurfaceProvider';
import { PhysicsMath } from './math/PhysicsMath';
import { stabilizeVehicleAfterImpact } from './CrashStability';
import { SuspensionKinematicsAdapter } from './SuspensionKinematicsAdapter';

export class Simulation {
  public vehicle: Vehicle;
  public suspensionKinematics: SuspensionKinematicsAdapter;
  public fixedDt: number = 1.0 / 120.0;
  public maxSubSteps: number = 8;
  public accumulatedTime: number = 0;
  public totalSimTime: number = 0;
  public stepCount: number = 0;

  private previousState: VehicleState;
  private currentState: VehicleState;

  constructor(config: VehicleConfig, surfaceProvider?: ISurfaceProvider) {
    this.vehicle = new Vehicle(config, surfaceProvider);
    this.suspensionKinematics = new SuspensionKinematicsAdapter(this.vehicle);
    this.configureSuspensionDynamics(config);
    this.previousState = this.vehicle.getState();
    this.currentState = this.vehicle.getState();
  }

  private configureSuspensionDynamics(config: VehicleConfig) {
    // The vertical wheel/hub inertia is intentionally configured independently of
    // wheel rotational inertia. The M5 preset uses 55 kg effective unsprung mass
    // per corner; lighter presets keep their own configured value.
    const unsprungMassCorner = Math.max(
      5,
      Number((config as any).unsprungMassCorner ?? 45)
    );
    this.vehicle.suspension.setUnsprungMassCorner(unsprungMassCorner);
    this.vehicle.suspension.tireVerticalDampingNsPerM = Math.max(
      0,
      Number((config as any).tireVerticalDamping ?? 1500)
    );

    // The four wheel/hub vertical coordinates are now genuine generalized masses.
    // Keep the measured complete-vehicle mass in planar translation, but remove
    // those independently integrated masses from the chassis heave coordinate.
    // This avoids counting the same 55 kg/corner twice while preserving the M5's
    // authoritative curb mass for acceleration and braking.
    const totalUnsprungMass = unsprungMassCorner * 4;
    this.vehicle.rigidBody.verticalMass = Math.max(
      config.mass * 0.5,
      config.mass - totalUnsprungMass
    );
  }

  public reset(x: number = 0, z: number = 0, yaw: number = 0) {
    this.vehicle.reset(x, z, yaw);
    // Wheel-center positions are world-space dynamic states now; they must be reset
    // together with the chassis so a restart cannot carry old suspension energy.
    this.vehicle.suspension.reset();
    this.configureSuspensionDynamics(this.vehicle.config);
    this.suspensionKinematics.reset();
    this.accumulatedTime = 0;
    this.totalSimTime = 0;
    this.stepCount = 0;
    this.previousState = this.vehicle.getState();
    this.currentState = this.vehicle.getState();
  }

  public setConfig(newConfig: VehicleConfig) {
    const oldCgHeight = this.vehicle.config.centerOfGravityHeight;

    // Vehicle owns the authoritative chassis mass-property derivation. Keeping it
    // there guarantees constructor and runtime tuning/preset swaps use the exact
    // same inertia tensor, axle positions, and unequal front/rear tracks.
    this.vehicle.setConfig(newConfig);
    this.configureSuspensionDynamics(newConfig);
    this.suspensionKinematics.rebuild();

    // RigidBody.position is the physical CG. Preserve its ground-relative height
    // if the tuning UI or a preset swap changes the configured CG height.
    const newCgHeight = newConfig.centerOfGravityHeight;
    if (Number.isFinite(oldCgHeight) && Number.isFinite(newCgHeight)) {
      this.vehicle.rigidBody.position.y += newCgHeight - oldCgHeight;
    }

    this.currentState = this.vehicle.getState();
    this.previousState = this.currentState;
  }

  /**
   * Advance simulation by variable render frame deltaTime.
   * Uses fixed 120 Hz accumulator with state interpolation.
   */
  public advance(deltaTime: number, inputs: ControlInputs): VehicleState {
    const clampedDelta = Math.min(deltaTime, 0.1);
    this.accumulatedTime += clampedDelta;

    let subStepsTaken = 0;
    // Render frame deltas such as 1/30 and 1/60 are not exactly representable in
    // binary floating point. Without a tiny tolerance, one cadence can occasionally
    // sit microscopically below fixedDt and skip a 120 Hz step that another cadence
    // executes. That creates false frame-rate-dependent handling.
    const timeEpsilon = 1e-10;

    while (this.accumulatedTime + timeEpsilon >= this.fixedDt && subStepsTaken < this.maxSubSteps) {
      this.previousState = this.currentState;
      this.vehicle.step(inputs, this.fixedDt);
      stabilizeVehicleAfterImpact(this.vehicle, this.fixedDt);
      this.currentState = this.vehicle.getState();

      this.accumulatedTime -= this.fixedDt;
      if (Math.abs(this.accumulatedTime) < timeEpsilon) this.accumulatedTime = 0;
      this.totalSimTime += this.fixedDt;
      this.stepCount++;
      subStepsTaken++;
    }

    if (this.accumulatedTime > this.fixedDt * 2) {
      this.accumulatedTime = 0;
    }

    const alpha = Math.min(1.0, Math.max(0, this.accumulatedTime / this.fixedDt));
    return this.interpolateState(this.previousState, this.currentState, alpha);
  }

  public stepExplicit(inputs: ControlInputs, steps: number = 1): VehicleState {
    for (let i = 0; i < steps; i++) {
      this.vehicle.step(inputs, this.fixedDt);
      stabilizeVehicleAfterImpact(this.vehicle, this.fixedDt);
      this.totalSimTime += this.fixedDt;
      this.stepCount++;
    }
    this.currentState = this.vehicle.getState();
    this.previousState = this.currentState;
    return this.currentState;
  }

  private interpolateState(prev: VehicleState, curr: VehicleState, alpha: number): VehicleState {
    // When the accumulator remainder is ~0 we just completed step(s).
    // Returning prev would render one 120 Hz step behind on exact
    // cadences (60fps=2 steps, 30fps=4 steps) and alternate stale/smooth.
    // Return the latest physics state instead. Zero-step high-refresh
    // frames still interpolate below via hub/heave/pose lerp.
    if (alpha <= 0.001) return curr;
    if (alpha >= 0.999) return curr;

    const lerp = PhysicsMath.lerp;
    const yawDiff = ((((curr.yaw - prev.yaw) % (Math.PI * 2)) + Math.PI * 3) % (Math.PI * 2)) - Math.PI;

    return {
      ...curr,
      x: lerp(prev.x, curr.x, alpha),
      y: lerp(prev.y, curr.y, alpha),
      z: lerp(prev.z, curr.z, alpha),
      // Track elevation drives CarRenderer rootGroup.y. Leaving it at curr
      // while x/z/heave/hub are interpolated steps the body at 120 Hz on
      // graded showcase road. Interpolate like the other pose channels.
      elevationHeight: lerp(
        Number.isFinite((prev as any).elevationHeight) ? (prev as any).elevationHeight : (curr as any).elevationHeight,
        Number.isFinite((curr as any).elevationHeight) ? (curr as any).elevationHeight : (prev as any).elevationHeight,
        alpha
      ),
      yaw: prev.yaw + yawDiff * alpha,
      pitch: lerp(prev.pitch, curr.pitch, alpha),
      roll: lerp(prev.roll, curr.roll, alpha),
      // CarRenderer positions the sprung body from road-relative heave rather than
      // raw world Y. Interpolate it too; otherwise the chassis visibly snaps at the
      // 120 Hz physics cadence even while x/y/z and pitch/roll are smoothed.
      heave: lerp(prev.heave, curr.heave, alpha),
      speedMs: lerp(prev.speedMs, curr.speedMs, alpha),
      speedKmh: lerp(prev.speedKmh, curr.speedKmh, alpha),
      speedMph: lerp(prev.speedMph, curr.speedMph, alpha),
      rpm: lerp(prev.rpm, curr.rpm, alpha),
      lateralG: lerp(prev.lateralG, curr.lateralG, alpha),
      longitudinalG: lerp(prev.longitudinalG, curr.longitudinalG, alpha),
      verticalG: lerp(prev.verticalG, curr.verticalG, alpha),
      actualSteerAngle: lerp(prev.actualSteerAngle, curr.actualSteerAngle, alpha),
      turboBoostPsi: lerp(prev.turboBoostPsi, curr.turboBoostPsi, alpha),
      wheels: curr.wheels.map((w, i) => {
        const pw = prev.wheels[i];
        const currHub = (w as any).hubWorldPos as { x: number; y: number; z: number } | undefined;
        const prevHub = (pw as any).hubWorldPos as { x: number; y: number; z: number } | undefined;
        const currContact = (w as any).groundContactPos as { x: number; y: number; z: number } | undefined;
        const prevContact = (pw as any).groundContactPos as { x: number; y: number; z: number } | undefined;

        return {
          ...w,
          suspensionCompression: lerp(pw.suspensionCompression, w.suspensionCompression, alpha),
          verticalTravelM: lerp(pw.verticalTravelM, w.verticalTravelM, alpha),
          rotationAngle: lerp(pw.rotationAngle, w.rotationAngle, alpha),
          steerAngle: lerp(pw.steerAngle, w.steerAngle, alpha),
          forceVectorLong: lerp(pw.forceVectorLong, w.forceVectorLong, alpha),
          forceVectorLat: lerp(pw.forceVectorLat, w.forceVectorLat, alpha),
          forceVectorNorm: lerp(pw.forceVectorNorm, w.forceVectorNorm, alpha),
          // The wheel renderer prefers the physical world-space hub coordinate.
          // Leaving it at the current fixed step bypassed all of the interpolation
          // above and made the wheels visibly tick at 120 Hz on high-refresh screens.
          hubWorldPos: currHub && prevHub
            ? {
                x: lerp(prevHub.x, currHub.x, alpha),
                y: lerp(prevHub.y, currHub.y, alpha),
                z: lerp(prevHub.z, currHub.z, alpha),
              }
            : currHub,
          groundContactPos: currContact && prevContact
            ? {
                x: lerp(prevContact.x, currContact.x, alpha),
                y: lerp(prevContact.y, currContact.y, alpha),
                z: lerp(prevContact.z, currContact.z, alpha),
              }
            : currContact,
        };
      }) as any,
    };
  }
}

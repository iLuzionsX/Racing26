import type { Vehicle } from './Vehicle';
import { PhysicsMath } from './math/PhysicsMath';
import {
  createVirtualSuspensionCornerGeometry,
  normalizeHeadingDelta,
  solveSuspensionKinematics,
  staticRollCenterBodyY,
  transformForceToCommandFrame,
  transformVelocityToKinematicFrame,
  type SuspensionCornerGeometry,
  type WheelKinematicPose,
} from './SuspensionKinematics';

/**
 * Bridges the geometry solver into the existing Vehicle loop without replacing the
 * proven vertical unsprung-mass/spring solver. Vehicle currently asks each tire for
 * forces in a scalar steering-angle frame; this adapter rotates velocity into the
 * true kinematic wheel frame, runs WheelDynamics there, then rotates the resulting
 * shear force back into the frame Vehicle expects. The world-space force is therefore
 * unchanged by the compatibility bridge and follows the solved wheel orientation.
 */
export class SuspensionKinematicsAdapter {
  public geometries: [
    SuspensionCornerGeometry,
    SuspensionCornerGeometry,
    SuspensionCornerGeometry,
    SuspensionCornerGeometry,
  ];
  public poses: [WheelKinematicPose, WheelKinematicPose, WheelKinematicPose, WheelKinematicPose];

  private readonly vehicle: Vehicle;
  private wheelAdaptersInstalled = false;
  private stateAdapterInstalled = false;

  constructor(vehicle: Vehicle) {
    this.vehicle = vehicle;
    this.geometries = [] as unknown as SuspensionKinematicsAdapter['geometries'];
    this.poses = [] as unknown as SuspensionKinematicsAdapter['poses'];
    this.rebuild();
    this.installWheelAdapters();
    this.installStateAdapter();
  }

  public rebuild() {
    const config = this.vehicle.config as any;
    const hardpoints = this.vehicle.getHardpointsBody();
    const maxDroopM = Math.max(0.01, Number(config.suspensionMaxDroopM ?? 0.12));
    const maxBumpM = Math.max(0.01, Number(config.suspensionMaxBumpM ?? 0.14));
    const camberGain = Math.max(0, Number(config.camberGain ?? 0));

    this.geometries = hardpoints.map((mountBody, index) => {
      const isFront = index < 2;
      const isLeft = index === 0 || index === 2;
      return createVirtualSuspensionCornerGeometry({
        mountBody,
        isFront,
        isLeft,
        restLength: Math.max(0.01, Number(config.suspensionRestLength ?? 0.34)),
        maxDroopM,
        maxBumpM,
        wheelRadiusM: Math.max(0.05, Number(config.wheelRadius ?? 0.33)),
        staticCamberDeg: Number(
          isFront ? config.camberStaticFront ?? -1.5 : config.camberStaticRear ?? -1.2
        ),
        targetCamberGainDegPerMeter: camberGain,
        casterDeg: Number(
          isFront ? config.frontCasterDeg ?? 7.2 : config.rearVirtualCasterDeg ?? 0
        ),
        kingpinInclinationDeg: Number(
          isFront ? config.frontKingpinInclinationDeg ?? 7.0 : config.rearVirtualKingpinInclinationDeg ?? 0
        ),
        bumpSteerBiasM: Number(
          isFront ? config.frontBumpSteerBiasM ?? 0.0015 : config.rearBumpSteerBiasM ?? 0.0010
        ),
      });
    }) as SuspensionKinematicsAdapter['geometries'];

    this.vehicle.planarSupportBodyYByCorner = this.geometries.map(
      staticRollCenterBodyY
    ) as [number, number, number, number];

    this.reset();
  }

  public reset() {
    this.poses = this.geometries.map((geometry, index) => {
      const travel = this.vehicle.suspension.states[index]?.displacement ?? 0;
      const steer = this.vehicle.wheels[index]?.steerAngle ?? 0;
      return solveSuspensionKinematics(geometry, travel, steer);
    }) as SuspensionKinematicsAdapter['poses'];
  }

  private installWheelAdapters() {
    if (this.wheelAdaptersInstalled) return;
    this.wheelAdaptersInstalled = true;

    this.vehicle.wheels.forEach((wheel, index) => {
      const originalUpdate = wheel.update.bind(wheel);

      wheel.update = ((
        longitudinalVelocity: number,
        lateralVelocity: number,
        verticalLoad: number,
        _legacyCamberDeg: number,
        driveTorque: number,
        hydraulicBrakeTorque: number,
        handbrakeTorque: number,
        surfaceFriction: number,
        rollingResistance: number,
        dt: number,
        reflectedDrivelineInertia: number = 0
      ) => {
        // Vehicle writes the Ackermann/rear-steer command immediately before the
        // suspension solve. Treat that scalar as rack intent; the geometry solver
        // adds bump steer and rotates the wheel about its actual caster/KPI axis.
        const commandedSteer = wheel.steerAngle;
        const suspensionState = this.vehicle.suspension.states[index];
        const geometry = this.geometries[index];
        const pose = solveSuspensionKinematics(
          geometry,
          suspensionState?.displacement ?? 0,
          commandedSteer
        );
        this.poses[index] = pose;

        const headingDelta = normalizeHeadingDelta(pose.headingRad - commandedSteer);
        const kinematicVelocity = transformVelocityToKinematicFrame(
          longitudinalVelocity,
          lateralVelocity,
          headingDelta
        );

        // WheelDynamics keeps its transient brush/relaxation state in wheel-local
        // axes. Expose the solved heading before update so stationary steering cannot
        // rotate stored tire shear into the chassis and reintroduce PR #9's shimmy.
        wheel.steerAngle = pose.headingRad;
        if (suspensionState) suspensionState.dynamicCamberDeg = pose.camberDeg;

        const tireForceInKinematicFrame = originalUpdate(
          kinematicVelocity.longitudinal,
          kinematicVelocity.lateral,
          verticalLoad,
          pose.camberDeg,
          driveTorque,
          hydraulicBrakeTorque,
          handbrakeTorque,
          surfaceFriction,
          rollingResistance,
          dt,
          reflectedDrivelineInertia
        );

        // Vehicle has already cached sin/cos for commandedSteer before calling us.
        // Rotate the shear components back so that when Vehicle applies that cached
        // basis the resulting body/world force exactly matches the kinematic basis.
        const commandFrameForce = transformForceToCommandFrame(
          tireForceInKinematicFrame.fx,
          tireForceInKinematicFrame.fy,
          headingDelta
        );

        return {
          ...tireForceInKinematicFrame,
          fx: commandFrameForce.longitudinal,
          fy: commandFrameForce.lateral,
        };
      }) as typeof wheel.update;
    });
  }

  private installStateAdapter() {
    if (this.stateAdapterInstalled) return;
    this.stateAdapterInstalled = true;
    const baseGetState = this.vehicle.getState.bind(this.vehicle);

    this.vehicle.getState = (() => {
      const state = baseGetState();
      state.wheels.forEach((wheelState, index) => {
        const pose = this.poses[index];
        const geometry = this.geometries[index];
        if (!pose || !geometry) return;

        wheelState.steerAngle = pose.headingRad;
        wheelState.camberAngleDeg = pose.camberDeg;

        // Keep the established authoritative vertical unsprung position while
        // exposing the small lateral/longitudinal hub migration from control-arm arcs.
        const hub = (wheelState as any).hubWorldPos as { x: number; y: number; z: number } | undefined;
        const contact = (wheelState as any).groundContactPos as { x: number; y: number; z: number } | undefined;
        const migrationBody = PhysicsMath.vec3(
          pose.hubCenterBody.x - geometry.hubCenterAtRestBody.x,
          0,
          pose.hubCenterBody.z - geometry.hubCenterAtRestBody.z
        );
        const migrationWorld = PhysicsMath.quatRotateVec3(
          this.vehicle.rigidBody.orientation,
          migrationBody
        );
        if (hub) {
          hub.x += migrationWorld.x;
          hub.z += migrationWorld.z;
        }
        if (contact) {
          contact.x += migrationWorld.x;
          contact.z += migrationWorld.z;
        }

        Object.assign(wheelState as any, {
          bumpSteerDeg: pose.bumpSteerDeg,
          casterDeg: pose.casterDeg,
          kingpinInclinationDeg: pose.kingpinInclinationDeg,
          scrubRadiusM: pose.scrubRadiusM,
          kinematicHubLocalPos: { ...pose.hubCenterBody },
          wheelForwardBody: { ...pose.forwardBody },
          wheelLateralBody: { ...pose.lateralBody },
          wheelUpBody: { ...pose.upBody },
        });
      });
      return state;
    }) as typeof this.vehicle.getState;
  }
}

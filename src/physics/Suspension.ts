import { Vec3, Quat, PhysicsMath } from './math/PhysicsMath';

export interface SuspensionCornerConfig {
  restLength: number;
  springStiffness: number;
  dampingLowSpeed: number;
  dampingHighSpeed: number;
  dampingRebound: number;
  bumpStopStiffness: number;
  bumpStopThreshold: number;
  maxDroop: number;
  maxBump: number;
  staticCamberDeg: number;
  camberGainDegPerMeter: number;
  antiDiveSquatRatio: number;
  springProgressionRatio?: number;
  dampingReboundHighSpeed?: number;
  damperKneeVelocity?: number;
  damperHighSpeedVelocity?: number;
  bumpStopProgression?: number;
  bumpStopExponent?: number;
}

export interface AntiRollBarForcePair {
  /** Left suspension travel minus right suspension travel. Positive means left is more compressed. */
  differentialTravelM: number;
  /** Positive is an upward reaction on the chassis / downward reaction on the unsprung corner. */
  leftChassisForceN: number;
  /** Equal-and-opposite reaction at the right corner. */
  rightChassisForceN: number;
  /** Absolute force transferred from one side of the axle to the other. */
  transferMagnitudeN: number;
}

export interface SuspensionState {
  displacement: number;
  velocity: number;
  compressionRatio: number;
  hubTravelM: number;
  bumpStopEngaged: boolean;
  atCompressionLimit: boolean;
  atReboundLimit: boolean;
  /** Chassis-side vertical suspension reaction retained for Vehicle compatibility. */
  forceNorm: number;
  /** Suspension reaction actually transmitted into the sprung chassis this fixed step. */
  chassisForceN: number;
  /** Explicit alias for validation telemetry. */
  appliedChassisForceN: number;
  /** Spring/damper/ARB/hard-stop reaction evaluated after the unsprung integration. */
  evaluatedChassisForceN: number;
  /** Instantaneous vertical road load at the tire contact patch. */
  tireNormalForceN: number;
  springForceN: number;
  damperForceN: number;
  bumpStopForceN: number;
  hardStopForceN: number;
  /** Axle-local anti-roll-bar contribution only; excludes optional diagonal coupling. */
  antiRollBarForceN: number;
  dynamicCamberDeg: number;
  isAirborne: boolean;
  contactPointWorld: Vec3;
  tireCompressionM: number;
  /** Independent vertical wheel/hub state: the unsprung DOF. */
  hubPositionWorldY: number;
  hubVelocityWorldY: number;
  unsprungAccelerationMps2: number;
  unsprungMassKg: number;
}

type SurfaceLike = {
  elevation: number;
  normal: Vec3;
};

const makeState = (): SuspensionState => ({
  displacement: 0,
  velocity: 0,
  compressionRatio: 0,
  hubTravelM: 0,
  bumpStopEngaged: false,
  atCompressionLimit: false,
  atReboundLimit: false,
  forceNorm: 0,
  chassisForceN: 0,
  appliedChassisForceN: 0,
  evaluatedChassisForceN: 0,
  tireNormalForceN: 0,
  springForceN: 0,
  damperForceN: 0,
  bumpStopForceN: 0,
  hardStopForceN: 0,
  antiRollBarForceN: 0,
  dynamicCamberDeg: 0,
  isAirborne: true,
  contactPointWorld: PhysicsMath.vec3(),
  tireCompressionM: 0,
  hubPositionWorldY: Number.NaN,
  hubVelocityWorldY: 0,
  unsprungAccelerationMps2: 0,
  unsprungMassKg: 45,
});

/**
 * Incremental coil-spring force about the installed/preloaded ride position.
 * Compression is progressive; droop remains linear until spring load reaches zero.
 */
export function progressiveSpringIncrement(
  displacement: number,
  baseRate: number,
  maxBump: number,
  progressionRatio: number = 0.65
): number {
  const k = Math.max(0, baseRate);
  if (displacement <= 0 || k === 0) return k * displacement;

  const travel = Math.max(0.001, maxBump);
  const progression = Math.max(0, progressionRatio);
  const x = displacement;

  // Integrate k(x) = k0 * (1 + progression * (x / travel)^2).
  return k * x + (k * progression * x * x * x) / (3 * travel * travel);
}

/**
 * 2-way digressive damper: bump/compression and rebound have independent
 * low- and high-shaft-speed valving. Positive velocity is compression.
 */
export function damperForceForVelocity(
  velocity: number,
  compressionLowSpeed: number,
  compressionHighSpeed: number,
  reboundLowSpeed: number,
  reboundHighSpeed: number,
  kneeVelocity: number = 0.12,
  highSpeedVelocity: number = 0.77
): number {
  if (!Number.isFinite(velocity) || velocity === 0) return 0;

  const absVelocity = Math.abs(velocity);
  const knee = Math.max(0, kneeVelocity);
  const span = Math.max(0.01, highSpeedVelocity - knee);
  const linearBlend = PhysicsMath.clamp((absVelocity - knee) / span, 0, 1);
  const blend = linearBlend * linearBlend * (3 - 2 * linearBlend);

  const low = velocity > 0
    ? Math.max(0, compressionLowSpeed)
    : Math.max(0, reboundLowSpeed);
  const high = velocity > 0
    ? Math.max(0, compressionHighSpeed)
    : Math.max(0, reboundHighSpeed);

  return PhysicsMath.lerp(low, high, blend) * velocity;
}

/** Progressive elastomer bump-stop load once the configured jounce threshold is reached. */
export function bumpStopForceForDisplacement(
  displacement: number,
  maxBump: number,
  thresholdRatio: number,
  stiffness: number,
  progression: number = 4.0,
  exponent: number = 2.2
): number {
  const travel = Math.max(0.001, maxBump);
  const threshold = travel * PhysicsMath.clamp(thresholdRatio, 0, 0.98);
  if (displacement <= threshold) return 0;

  const bumpRange = Math.max(0.003, travel - threshold);
  const bumpTravel = displacement - threshold;
  const progress = Math.max(0, bumpTravel / bumpRange);

  return Math.max(0, stiffness) * bumpTravel *
    (1 + Math.max(0, progression) * Math.pow(progress, Math.max(1, exponent)));
}

/**
 * Convert left/right differential suspension travel into the equal-and-opposite
 * vertical forces produced by an anti-roll bar at the wheel centers.
 *
 * `effectiveWheelRateNPerM` is the bar's installed/effective wheel rate rather
 * than the raw torsional rate of the steel bar. That keeps suspension motion ratio
 * and lever-arm geometry outside the real-time solver while preserving the physics:
 * equal bump gives zero force, and differential bump transfers load across the axle.
 */
export function calculateAntiRollBarForces(
  leftDisplacementM: number,
  rightDisplacementM: number,
  effectiveWheelRateNPerM: number
): AntiRollBarForcePair {
  const left = Number.isFinite(leftDisplacementM) ? leftDisplacementM : 0;
  const right = Number.isFinite(rightDisplacementM) ? rightDisplacementM : 0;
  const rate = Number.isFinite(effectiveWheelRateNPerM)
    ? Math.max(0, effectiveWheelRateNPerM)
    : 0;
  const differentialTravelM = left - right;
  const leftChassisForceN = rate * differentialTravelM;

  return {
    differentialTravelM,
    leftChassisForceN,
    rightChassisForceN: -leftChassisForceN,
    transferMagnitudeN: Math.abs(leftChassisForceN),
  };
}

/**
 * Four independent spring/damper corners with a true vertical unsprung DOF.
 *
 * The wheel center is no longer snapped directly to the road-height solution every
 * frame. Tire vertical load accelerates the wheel/hub effective mass first; spring,
 * damper and anti-roll forces then transmit that motion into the chassis. This is
 * the important two-stage response that makes a heavy car react to a bump as a
 * wheel assembly followed by a ~2.4-ton body instead of as one rigid object.
 */
export class SuspensionSystem {
  public states: [SuspensionState, SuspensionState, SuspensionState, SuspensionState] = [
    makeState(), makeState(), makeState(), makeState(),
  ];

  public unsprungMassKgByCorner: [number, number, number, number] = [45, 45, 45, 45];
  public tireVerticalDampingNsPerM: number = 1500;

  public reset() {
    this.states = [makeState(), makeState(), makeState(), makeState()];
  }

  public setUnsprungMassCorner(mass: number | [number, number, number, number]) {
    if (Array.isArray(mass)) {
      this.unsprungMassKgByCorner = mass.map((value) =>
        Math.max(5, Number.isFinite(value) ? value : 45)
      ) as [number, number, number, number];
      return;
    }

    const value = Math.max(5, Number.isFinite(mass) ? mass : 45);
    this.unsprungMassKgByCorner = [value, value, value, value];
  }

  private springForce(cfg: SuspensionCornerConfig, displacement: number): number {
    // Installed spring preload carries static chassis load at nominal ride height.
    const preloadTravel = Math.max(0, cfg.maxDroop) * 0.78;
    const preloadForce = preloadTravel * Math.max(0, cfg.springStiffness);

    return Math.max(
      0,
      preloadForce + progressiveSpringIncrement(
        displacement,
        cfg.springStiffness,
        Math.max(0.001, cfg.maxBump),
        cfg.springProgressionRatio ?? 0.65
      )
    );
  }

  /**
   * Start a fresh wheel at static tire/spring/unsprung-weight equilibrium instead
   * of introducing a fake first-frame impact.
   */
  private initializeHubPositionY(
    hardpointY: number,
    surfaceY: number,
    wheelRadius: number,
    tireVerticalStiffness: number,
    unsprungMassKg: number,
    cfg: SuspensionCornerConfig
  ): number {
    const pickupOffset = Math.max(0, cfg.maxDroop);
    const minDisplacement = -Math.max(0, cfg.maxDroop);
    const maxDisplacement = Math.max(0.001, cfg.maxBump);

    // Displacement that would put an infinitely stiff tire exactly on the road.
    const groundDisplacement =
      surfaceY + wheelRadius - hardpointY + pickupOffset + cfg.restLength;

    if (groundDisplacement <= minDisplacement) {
      return hardpointY - pickupOffset - cfg.restLength + minDisplacement;
    }

    let low = minDisplacement;
    let high = Math.min(maxDisplacement, groundDisplacement);

    const loadBalance = (displacement: number) => {
      const tireCompression = Math.max(0, groundDisplacement - displacement);
      const tireForce = tireCompression * tireVerticalStiffness;
      const suspensionForce =
        this.springForce(cfg, displacement) +
        bumpStopForceForDisplacement(
          displacement,
          maxDisplacement,
          cfg.bumpStopThreshold,
          cfg.bumpStopStiffness,
          cfg.bumpStopProgression ?? 4.0,
          cfg.bumpStopExponent ?? 2.2
        );
      return tireForce - suspensionForce - Math.max(0, unsprungMassKg) * 9.81;
    };

    if (loadBalance(low) < 0) {
      return hardpointY - pickupOffset - cfg.restLength + low;
    }

    for (let iteration = 0; iteration < 24; iteration++) {
      const mid = (low + high) * 0.5;
      if (loadBalance(mid) > 0) low = mid;
      else high = mid;
    }

    const displacement = (low + high) * 0.5;
    return hardpointY - pickupOffset - cfg.restLength + displacement;
  }

  public update(
    hardpointsBody: [Vec3, Vec3, Vec3, Vec3],
    bodyPosition: Vec3,
    bodyOrientation: Quat,
    bodyVelocityWorld: Vec3,
    bodyAngularVelocityWorld: Vec3,
    sampleSurface: (x: number, z: number) => SurfaceLike,
    configs: [SuspensionCornerConfig, SuspensionCornerConfig, SuspensionCornerConfig, SuspensionCornerConfig],
    rollStiffnessFront: number,
    rollStiffnessRear: number,
    antiRollCrossCoupling: number,
    wheelRadius: number,
    tireVerticalStiffness: number,
    dt: number,
    planarHubBodyY: number = 0
  ) {
    if (dt <= 0) return;

    const tireK = Math.max(1000, tireVerticalStiffness);
    const tireC = Math.max(0, this.tireVerticalDampingNsPerM);

    const hardpointsWorld: Vec3[] = new Array(4);
    const hardpointVelocitiesWorld: Vec3[] = new Array(4);
    const planarSupportsWorld: Vec3[] = new Array(4);
    const roadVelocitiesY = [0, 0, 0, 0];
    const surfaces: SurfaceLike[] = new Array(4);
    const currentDisplacements = [0, 0, 0, 0];
    const baseChassisForces = [0, 0, 0, 0];
    const tireForces = [0, 0, 0, 0];

    // Evaluate forces at the beginning of the fixed step.
    for (let i = 0; i < 4; i++) {
      const cfg = configs[i];
      const hardpointWorldOffset = PhysicsMath.quatRotateVec3(bodyOrientation, hardpointsBody[i]);
      const hardpointWorld = PhysicsMath.vec3Add(bodyPosition, hardpointWorldOffset);
      const angularPointVelocity = PhysicsMath.vec3Cross(bodyAngularVelocityWorld, hardpointWorldOffset);
      const hardpointVelocityWorld = PhysicsMath.vec3Add(bodyVelocityWorld, angularPointVelocity);

      // The unsprung model is a world-vertical slider, so its independent state is
      // Y only. X/Z still need a body-fixed support line. Anchor that line at the
      // nominal wheel-center plane, not at the suspension top mount. Rotating the
      // top-mount height into X/Z made the wheels sweep laterally by centimeters
      // relative to the wheel arches as the chassis rolled.
      const planarSupportBody = PhysicsMath.vec3(
        hardpointsBody[i].x,
        planarHubBodyY,
        hardpointsBody[i].z
      );
      const planarSupportWorldOffset = PhysicsMath.quatRotateVec3(
        bodyOrientation,
        planarSupportBody
      );
      const planarSupportWorld = PhysicsMath.vec3Add(
        bodyPosition,
        planarSupportWorldOffset
      );
      const planarSupportAngularVelocity = PhysicsMath.vec3Cross(
        bodyAngularVelocityWorld,
        planarSupportWorldOffset
      );
      const planarSupportVelocityWorld = PhysicsMath.vec3Add(
        bodyVelocityWorld,
        planarSupportAngularVelocity
      );

      const surface = sampleSurface(planarSupportWorld.x, planarSupportWorld.z);
      const pickupOffset = Math.max(0, cfg.maxDroop);

      let state = this.states[i];
      if (!Number.isFinite(state.hubPositionWorldY)) {
        const unsprungMassKg = Math.max(5, this.unsprungMassKgByCorner[i]);
        const hubPositionWorldY = this.initializeHubPositionY(
          hardpointWorld.y,
          surface.elevation,
          wheelRadius,
          tireK,
          unsprungMassKg,
          cfg
        );
        state = {
          ...state,
          hubPositionWorldY,
          hubVelocityWorldY: hardpointVelocityWorld.y,
        };
        this.states[i] = state;
      }

      const minDisplacement = -Math.max(0, cfg.maxDroop);
      const maxDisplacement = Math.max(0.001, cfg.maxBump);
      const displacement = PhysicsMath.clamp(
        state.hubPositionWorldY - hardpointWorld.y + pickupOffset + cfg.restLength,
        minDisplacement,
        maxDisplacement
      );
      const shaftVelocity = state.hubVelocityWorldY - hardpointVelocityWorld.y;

      const springForce = this.springForce(cfg, displacement);
      const reboundHighSpeed = cfg.dampingReboundHighSpeed ??
        Math.max(cfg.dampingHighSpeed * 1.10, cfg.dampingRebound * 0.62);
      const damperForce = damperForceForVelocity(
        shaftVelocity,
        cfg.dampingLowSpeed,
        cfg.dampingHighSpeed,
        cfg.dampingRebound,
        reboundHighSpeed,
        cfg.damperKneeVelocity ?? 0.12,
        cfg.damperHighSpeedVelocity ?? 0.77
      );
      const bumpStopForce = bumpStopForceForDisplacement(
        displacement,
        maxDisplacement,
        cfg.bumpStopThreshold,
        cfg.bumpStopStiffness,
        cfg.bumpStopProgression ?? 4.0,
        cfg.bumpStopExponent ?? 2.2
      );

      // Surface normal gives the vertical velocity of a spatial road profile as the
      // wheel moves horizontally across it: dy/dt = -(nx*vx + nz*vz) / ny.
      const normalY = Math.abs(surface.normal.y) > 0.15 ? surface.normal.y : 1;
      const roadVelocityY = -(
        surface.normal.x * planarSupportVelocityWorld.x +
        surface.normal.z * planarSupportVelocityWorld.z
      ) / normalY;

      const tireCompression = Math.max(
        0,
        surface.elevation + wheelRadius - state.hubPositionWorldY
      );
      const tireForce = Math.max(
        0,
        tireCompression * tireK + (roadVelocityY - state.hubVelocityWorldY) * tireC
      );

      hardpointsWorld[i] = hardpointWorld;
      hardpointVelocitiesWorld[i] = hardpointVelocityWorld;
      planarSupportsWorld[i] = planarSupportWorld;
      roadVelocitiesY[i] = roadVelocityY;
      surfaces[i] = surface;
      currentDisplacements[i] = displacement;
      baseChassisForces[i] = Math.max(0, springForce + damperForce + bumpStopForce);
      tireForces[i] = tireForce;
    }

    // True axle-local anti-roll bars. Each bar reacts only to left/right differential
    // travel on its own axle. Equal bump/heave produces exactly zero ARB force.
    const antiRollBarForces = [0, 0, 0, 0];
    const frontBar = calculateAntiRollBarForces(
      currentDisplacements[0],
      currentDisplacements[1],
      rollStiffnessFront
    );
    const rearBar = calculateAntiRollBarForces(
      currentDisplacements[2],
      currentDisplacements[3],
      rollStiffnessRear
    );
    antiRollBarForces[0] = frontBar.leftChassisForceN;
    antiRollBarForces[1] = frontBar.rightChassisForceN;
    antiRollBarForces[2] = rearBar.leftChassisForceN;
    antiRollBarForces[3] = rearBar.rightChassisForceN;

    // Optional legacy diagonal coupling remains separate from the physical bars so
    // front/rear ARB balance stays well-defined and independently testable.
    const crossCouplingForces = [0, 0, 0, 0];
    const cross = PhysicsMath.clamp(antiRollCrossCoupling, 0, 1);
    if (cross > 0) {
      const diagonalDelta =
        (currentDisplacements[0] + currentDisplacements[3]) -
        (currentDisplacements[1] + currentDisplacements[2]);
      const averageBar = 0.25 * (rollStiffnessFront + rollStiffnessRear);
      const crossTransfer = diagonalDelta * averageBar * cross * 0.20;
      crossCouplingForces[0] += crossTransfer;
      crossCouplingForces[3] += crossTransfer;
      crossCouplingForces[1] -= crossTransfer;
      crossCouplingForces[2] -= crossTransfer;
    }

    const chassisForces = baseChassisForces.map(
      (baseForce, i) => baseForce + antiRollBarForces[i] + crossCouplingForces[i]
    );

    // Integrate each wheel/hub effective mass independently.
    for (let i = 0; i < 4; i++) {
      const cfg = configs[i];
      const hardpointWorld = hardpointsWorld[i];
      const hardpointVelocityWorld = hardpointVelocitiesWorld[i];
      const surface = surfaces[i];
      const pickupOffset = Math.max(0, cfg.maxDroop);
      const minDisplacement = -Math.max(0, cfg.maxDroop);
      const maxDisplacement = Math.max(0.001, cfg.maxBump);
      const unsprungMassKg = Math.max(5, this.unsprungMassKgByCorner[i]);
      const previous = this.states[i];

      // Use the same beginning-of-step suspension reaction for both sides of the
      // chassis-hub interaction. Road input changes tire force first; the wheel/hub
      // accelerates against the pre-existing spring/damper force, and the chassis
      // sees the changed suspension reaction only on the following 120 Hz sample.
      let currentChassisForce = chassisForces[i];
      if (currentDisplacements[i] >= maxDisplacement - 1e-6) {
        currentChassisForce += Math.max(0, tireForces[i] - currentChassisForce);
      }

      let unsprungAcceleration =
        (tireForces[i] - currentChassisForce - unsprungMassKg * 9.81) / unsprungMassKg;
      // Safety bound prevents a malformed terrain sample from destabilizing the 120 Hz solver.
      unsprungAcceleration = PhysicsMath.clamp(unsprungAcceleration, -300, 300);

      let hubVelocityWorldY = previous.hubVelocityWorldY + unsprungAcceleration * dt;
      let hubPositionWorldY = previous.hubPositionWorldY + hubVelocityWorldY * dt;
      const predictedDisplacement =
        hubPositionWorldY - hardpointWorld.y + pickupOffset + cfg.restLength;

      const hitCompressionLimit = predictedDisplacement >= maxDisplacement;
      const hitReboundLimit = predictedDisplacement <= minDisplacement;

      if (predictedDisplacement > maxDisplacement) {
        hubPositionWorldY =
          hardpointWorld.y - pickupOffset - cfg.restLength + maxDisplacement;
        if (hubVelocityWorldY > hardpointVelocityWorld.y) {
          hubVelocityWorldY = hardpointVelocityWorld.y;
        }
      } else if (predictedDisplacement < minDisplacement) {
        hubPositionWorldY =
          hardpointWorld.y - pickupOffset - cfg.restLength + minDisplacement;
        if (hubVelocityWorldY < hardpointVelocityWorld.y) {
          hubVelocityWorldY = hardpointVelocityWorld.y;
        }
      }

      const displacement = PhysicsMath.clamp(
        hubPositionWorldY - hardpointWorld.y + pickupOffset + cfg.restLength,
        minDisplacement,
        maxDisplacement
      );
      const shaftVelocity = hubVelocityWorldY - hardpointVelocityWorld.y;
      const springForce = this.springForce(cfg, displacement);
      const reboundHighSpeed = cfg.dampingReboundHighSpeed ??
        Math.max(cfg.dampingHighSpeed * 1.10, cfg.dampingRebound * 0.62);
      const damperForce = damperForceForVelocity(
        shaftVelocity,
        cfg.dampingLowSpeed,
        cfg.dampingHighSpeed,
        cfg.dampingRebound,
        reboundHighSpeed,
        cfg.damperKneeVelocity ?? 0.12,
        cfg.damperHighSpeedVelocity ?? 0.77
      );
      const bumpStopForce = bumpStopForceForDisplacement(
        displacement,
        maxDisplacement,
        cfg.bumpStopThreshold,
        cfg.bumpStopStiffness,
        cfg.bumpStopProgression ?? 4.0,
        cfg.bumpStopExponent ?? 2.2
      );
      const tireCompression = Math.max(
        0,
        surface.elevation + wheelRadius - hubPositionWorldY
      );
      const tireNormalForce = Math.max(
        0,
        tireCompression * tireK +
          (roadVelocitiesY[i] - hubVelocityWorldY) * tireC
      );

      const antiRollContribution = antiRollBarForces[i] + crossCouplingForces[i];
      const baseChassisForce = Math.max(0, springForce + damperForce + bumpStopForce);
      let evaluatedChassisForce = baseChassisForce + antiRollContribution;

      let hardStopForce = 0;
      if (hitCompressionLimit || displacement >= maxDisplacement - 1e-6) {
        hardStopForce = Math.max(0, tireNormalForce - evaluatedChassisForce);
        evaluatedChassisForce += hardStopForce;
      }

      const isAirborne = tireNormalForce < 1 && tireCompression <= 1e-5;

      this.states[i] = {
        displacement,
        velocity: shaftVelocity,
        compressionRatio: PhysicsMath.clamp(displacement / maxDisplacement, 0, 1),
        hubTravelM: displacement,
        bumpStopEngaged: bumpStopForce > 0,
        atCompressionLimit: hitCompressionLimit || displacement >= maxDisplacement - 1e-6,
        atReboundLimit: hitReboundLimit || displacement <= minDisplacement + 1e-6,
        forceNorm: currentChassisForce,
        chassisForceN: currentChassisForce,
        appliedChassisForceN: currentChassisForce,
        evaluatedChassisForceN: evaluatedChassisForce,
        tireNormalForceN: tireNormalForce,
        springForceN: springForce,
        damperForceN: damperForce,
        bumpStopForceN: bumpStopForce,
        hardStopForceN: hardStopForce,
        antiRollBarForceN: antiRollBarForces[i],
        dynamicCamberDeg:
          cfg.staticCamberDeg - cfg.camberGainDegPerMeter * Math.max(0, displacement),
        isAirborne,
        contactPointWorld: PhysicsMath.vec3(
          planarSupportsWorld[i].x,
          surface.elevation,
          planarSupportsWorld[i].z
        ),
        tireCompressionM: tireCompression,
        hubPositionWorldY,
        hubVelocityWorldY,
        unsprungAccelerationMps2: unsprungAcceleration,
        unsprungMassKg,
      };
    }
  }
}

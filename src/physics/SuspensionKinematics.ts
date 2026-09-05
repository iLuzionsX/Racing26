import { PhysicsMath, type Vec3 } from './math/PhysicsMath';

const DEG = Math.PI / 180;
const RAD = 180 / Math.PI;

export interface VirtualSuspensionGeometryInput {
  mountBody: Vec3;
  isFront: boolean;
  isLeft: boolean;
  restLength: number;
  maxDroopM: number;
  maxBumpM: number;
  wheelRadiusM: number;
  staticCamberDeg: number;
  targetCamberGainDegPerMeter: number;
  casterDeg?: number;
  kingpinInclinationDeg?: number;
  bumpSteerBiasM?: number;
}

export interface SuspensionCornerGeometry {
  isFront: boolean;
  isLeft: boolean;
  sideSign: 1 | -1;
  mountBody: Vec3;
  hubCenterAtRestBody: Vec3;
  lowerInnerBody: Vec3;
  upperInnerBody: Vec3;
  lowerBallJointAtRestBody: Vec3;
  upperBallJointAtRestBody: Vec3;
  tieRodInnerBody: Vec3;
  tieRodOuterAtRestBody: Vec3;
  tieRodLengthM: number;
  restSteeringAxisBody: Vec3;
  staticCamberDeg: number;
  derivedCamberGainDegPerMeter: number;
  maxDroopM: number;
  maxBumpM: number;
  wheelRadiusM: number;
}

export interface WheelKinematicPose {
  hubCenterBody: Vec3;
  lowerBallJointBody: Vec3;
  upperBallJointBody: Vec3;
  tieRodOuterBody: Vec3;
  steeringAxisBody: Vec3;
  forwardBody: Vec3;
  lateralBody: Vec3;
  upBody: Vec3;
  commandedSteerRad: number;
  headingRad: number;
  bumpSteerDeg: number;
  camberDeg: number;
  casterDeg: number;
  kingpinInclinationDeg: number;
  scrubRadiusM: number;
}

function rotateAroundAxis(vector: Vec3, axisInput: Vec3, angle: number): Vec3 {
  const axis = PhysicsMath.vec3Normalize(axisInput);
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const cross = PhysicsMath.vec3Cross(axis, vector);
  const along = PhysicsMath.vec3Scale(axis, PhysicsMath.vec3Dot(axis, vector) * (1 - c));
  return PhysicsMath.vec3Add(
    PhysicsMath.vec3Add(PhysicsMath.vec3Scale(vector, c), PhysicsMath.vec3Scale(cross, s)),
    along
  );
}

function rotatePointAroundAxis(point: Vec3, origin: Vec3, axis: Vec3, angle: number): Vec3 {
  return PhysicsMath.vec3Add(
    origin,
    rotateAroundAxis(PhysicsMath.vec3Sub(point, origin), axis, angle)
  );
}

function solveArmOuter(
  inner: Vec3,
  restOuter: Vec3,
  travelM: number,
  sideSign: 1 | -1
): Vec3 {
  const dx = restOuter.x - inner.x;
  const dy = restOuter.y - inner.y;
  const length = Math.max(1e-5, Math.hypot(dx, dy));
  const requestedDy = restOuter.y + travelM - inner.y;
  const constrainedDy = PhysicsMath.clamp(requestedDy, -length + 1e-7, length - 1e-7);
  const outboardDx = Math.sqrt(Math.max(1e-12, length * length - constrainedDy * constrainedDy));
  return PhysicsMath.vec3(
    inner.x + sideSign * outboardDx,
    inner.y + constrainedDy,
    restOuter.z
  );
}

function steeringAxisRoll(axis: Vec3): number {
  return Math.atan2(axis.x, Math.max(1e-8, axis.y));
}

function computeUnsteeredState(
  geometry: Pick<
    SuspensionCornerGeometry,
    | 'sideSign'
    | 'hubCenterAtRestBody'
    | 'lowerInnerBody'
    | 'upperInnerBody'
    | 'lowerBallJointAtRestBody'
    | 'upperBallJointAtRestBody'
    | 'restSteeringAxisBody'
    | 'staticCamberDeg'
  >,
  travelM: number
) {
  const lower = solveArmOuter(
    geometry.lowerInnerBody,
    geometry.lowerBallJointAtRestBody,
    travelM,
    geometry.sideSign
  );
  const upper = solveArmOuter(
    geometry.upperInnerBody,
    geometry.upperBallJointAtRestBody,
    travelM,
    geometry.sideSign
  );
  const axis = PhysicsMath.vec3Normalize(PhysicsMath.vec3Sub(upper, lower));
  const lowerDelta = PhysicsMath.vec3Sub(lower, geometry.lowerBallJointAtRestBody);
  const upperDelta = PhysicsMath.vec3Sub(upper, geometry.upperBallJointAtRestBody);
  const hubDelta = PhysicsMath.vec3Scale(PhysicsMath.vec3Add(lowerDelta, upperDelta), 0.5);
  const hub = PhysicsMath.vec3Add(geometry.hubCenterAtRestBody, hubDelta);

  const restRoll = steeringAxisRoll(geometry.restSteeringAxisBody);
  const currentRoll = steeringAxisRoll(axis);
  const camberRad =
    geometry.staticCamberDeg * DEG + geometry.sideSign * (currentRoll - restRoll);

  return { lower, upper, axis, hub, camberRad };
}

export function staticRollCenterBodyY(geometry: SuspensionCornerGeometry): number {
  // Front-view instant center: intersection of lower- and upper-arm lines.
  const a = geometry.lowerInnerBody;
  const b = geometry.lowerBallJointAtRestBody;
  const c = geometry.upperInnerBody;
  const d = geometry.upperBallJointAtRestBody;
  const denominator =
    (a.x - b.x) * (c.y - d.y) -
    (a.y - b.y) * (c.x - d.x);

  const contactY = geometry.hubCenterAtRestBody.y - geometry.wheelRadiusM;
  if (Math.abs(denominator) < 1e-10) return contactY;

  const abCross = a.x * b.y - a.y * b.x;
  const cdCross = c.x * d.y - c.y * d.x;
  const instantX =
    (abCross * (c.x - d.x) - (a.x - b.x) * cdCross) /
    denominator;
  const instantY =
    (abCross * (c.y - d.y) - (a.y - b.y) * cdCross) /
    denominator;

  const contactX = geometry.hubCenterAtRestBody.x;
  const dx = instantX - contactX;
  if (Math.abs(dx) < 1e-10) return contactY;

  // Line from tire contact patch to instant center, evaluated at vehicle centerline X=0.
  const t = -contactX / dx;
  const rollCenterY = contactY + (instantY - contactY) * t;
  return Number.isFinite(rollCenterY) ? rollCenterY : contactY;
}

function fitCircleCenter2D(a: Vec3, b: Vec3, c: Vec3): { x: number; y: number } {
  const d = 2 * (
    a.x * (b.y - c.y) +
    b.x * (c.y - a.y) +
    c.x * (a.y - b.y)
  );
  if (Math.abs(d) < 1e-10) {
    return { x: (a.x + b.x + c.x) / 3, y: (a.y + b.y + c.y) / 3 };
  }

  const aa = a.x * a.x + a.y * a.y;
  const bb = b.x * b.x + b.y * b.y;
  const cc = c.x * c.x + c.y * c.y;
  return {
    x: (aa * (b.y - c.y) + bb * (c.y - a.y) + cc * (a.y - b.y)) / d,
    y: (aa * (c.x - b.x) + bb * (a.x - c.x) + cc * (b.x - a.x)) / d,
  };
}

function derivedCamberGain(
  sideSign: 1 | -1,
  lowerInner: Vec3,
  upperInner: Vec3,
  lowerRest: Vec3,
  upperRest: Vec3,
  sampleTravelM: number = 0.05
): number {
  const restAxis = PhysicsMath.vec3Normalize(PhysicsMath.vec3Sub(upperRest, lowerRest));
  const lower = solveArmOuter(lowerInner, lowerRest, sampleTravelM, sideSign);
  const upper = solveArmOuter(upperInner, upperRest, sampleTravelM, sideSign);
  const axis = PhysicsMath.vec3Normalize(PhysicsMath.vec3Sub(upper, lower));
  const changeRad = sideSign * (steeringAxisRoll(axis) - steeringAxisRoll(restAxis));
  return (changeRad * RAD) / sampleTravelM;
}

function findUpperInnerDrop(
  sideSign: 1 | -1,
  upperRest: Vec3,
  lowerRest: Vec3,
  lowerInner: Vec3,
  upperArmSpanM: number,
  targetCamberGainDegPerMeter: number
): { upperInner: Vec3; derivedGain: number } {
  const target = -Math.abs(targetCamberGainDegPerMeter);
  const build = (drop: number) => PhysicsMath.vec3(
    upperRest.x - sideSign * upperArmSpanM,
    upperRest.y - drop,
    upperRest.z
  );
  const gainAt = (drop: number) => derivedCamberGain(
    sideSign,
    lowerInner,
    build(drop),
    lowerRest,
    upperRest
  );

  // A zero lower bound cannot represent mild camber-gain targets. For example,
  // the small-wheel default geometry already produces about -3 deg/m at zero drop.
  // Allow the virtual inner pivot to sit slightly above the outer joint as well as
  // below it, then solve the target from a true sign-changing bracket. This is only
  // virtual compatibility geometry; real imported pickup points bypass this fitting.
  const searchExtent = Math.max(0.08, upperArmSpanM * 0.35);
  let low = -searchExtent;
  let high = searchExtent;
  let lowError = gainAt(low) - target;
  let highError = gainAt(high) - target;

  if (lowError * highError > 0) {
    // If an extreme user target is outside the representable range, select the
    // closest physical endpoint rather than silently biasing toward one side.
    const chosen = Math.abs(lowError) <= Math.abs(highError) ? low : high;
    const upperInner = build(chosen);
    return { upperInner, derivedGain: gainAt(chosen) };
  }

  for (let i = 0; i < 56; i++) {
    const mid = (low + high) * 0.5;
    const midError = gainAt(mid) - target;
    if (Math.abs(midError) < 1e-8) {
      low = high = mid;
      break;
    }
    if (lowError * midError <= 0) {
      high = mid;
      highError = midError;
    } else {
      low = mid;
      lowError = midError;
    }
  }

  const fittedDrop = (low + high) * 0.5;
  const upperInner = build(fittedDrop);
  return {
    upperInner,
    derivedGain: gainAt(fittedDrop),
  };
}

export function createVirtualSuspensionCornerGeometry(
  input: VirtualSuspensionGeometryInput
): SuspensionCornerGeometry {
  const sideSign: 1 | -1 = input.isLeft ? 1 : -1;
  const casterDeg = input.casterDeg ?? (input.isFront ? 7.2 : 0);
  const kingpinDeg = input.kingpinInclinationDeg ?? (input.isFront ? 7.0 : 0);
  const wheelRadius = Math.max(0.05, input.wheelRadiusM);
  const maxDroop = Math.max(0.01, input.maxDroopM);
  const maxBump = Math.max(0.01, input.maxBumpM);
  const hub = PhysicsMath.vec3(
    input.mountBody.x,
    input.mountBody.y - maxDroop - Math.max(0.01, input.restLength),
    input.mountBody.z
  );

  // Virtual hardpoints are only a compatibility bridge for cars that do not yet
  // provide real pickup-point data. Existing scalar camber gain is used once here
  // to fit the upper-arm inner pivot; the runtime wheel pose is then solved from
  // link lengths instead of applying a camber coefficient every frame.
  const uprightSpan = PhysicsMath.clamp(wheelRadius * 0.95, 0.32, 0.38);
  const lowerRest = PhysicsMath.vec3(
    hub.x - sideSign * 0.008,
    hub.y - 0.12,
    hub.z + 0.015
  );
  const upperRest = PhysicsMath.vec3(
    lowerRest.x - sideSign * Math.tan(kingpinDeg * DEG) * uprightSpan,
    lowerRest.y + uprightSpan,
    lowerRest.z - Math.tan(casterDeg * DEG) * uprightSpan
  );
  const lowerArmSpan = PhysicsMath.clamp(wheelRadius * 0.92, 0.30, 0.36);
  const upperArmSpan = PhysicsMath.clamp(wheelRadius * 0.76, 0.25, 0.31);
  const lowerInner = PhysicsMath.vec3(
    lowerRest.x - sideSign * lowerArmSpan,
    lowerRest.y,
    lowerRest.z
  );
  const fittedUpper = findUpperInnerDrop(
    sideSign,
    upperRest,
    lowerRest,
    lowerInner,
    upperArmSpan,
    input.targetCamberGainDegPerMeter
  );
  const restAxis = PhysicsMath.vec3Normalize(PhysicsMath.vec3Sub(upperRest, lowerRest));

  const provisional: SuspensionCornerGeometry = {
    isFront: input.isFront,
    isLeft: input.isLeft,
    sideSign,
    mountBody: { ...input.mountBody },
    hubCenterAtRestBody: hub,
    lowerInnerBody: lowerInner,
    upperInnerBody: fittedUpper.upperInner,
    lowerBallJointAtRestBody: lowerRest,
    upperBallJointAtRestBody: upperRest,
    tieRodInnerBody: PhysicsMath.vec3(),
    tieRodOuterAtRestBody: PhysicsMath.vec3(),
    tieRodLengthM: 0,
    restSteeringAxisBody: restAxis,
    staticCamberDeg: input.staticCamberDeg,
    derivedCamberGainDegPerMeter: fittedUpper.derivedGain,
    maxDroopM: maxDroop,
    maxBumpM: maxBump,
    wheelRadiusM: wheelRadius,
  };

  const armLongitudinalOffset = -PhysicsMath.clamp(wheelRadius * 0.38, 0.12, 0.15);
  const tieOuter = PhysicsMath.vec3(
    hub.x - sideSign * 0.025,
    hub.y - 0.020,
    hub.z + armLongitudinalOffset
  );

  const zeroSteerOuterAt = (travelM: number): Vec3 => {
    const state = computeUnsteeredState(provisional, travelM);
    const physicalCamberRest = -sideSign * input.staticCamberDeg * DEG;
    const physicalCamberNow = -sideSign * state.camberRad;
    const offset = rotateAroundAxis(
      PhysicsMath.vec3Sub(tieOuter, hub),
      PhysicsMath.vec3(0, 0, 1),
      physicalCamberNow - physicalCamberRest
    );
    return PhysicsMath.vec3Add(state.hub, offset);
  };

  const fitTravel = Math.min(0.06, maxDroop * 0.75, maxBump * 0.75);
  const droopPoint = zeroSteerOuterAt(-fitTravel);
  const restPoint = zeroSteerOuterAt(0);
  const bumpPoint = zeroSteerOuterAt(fitTravel);
  const idealPivot = fitCircleCenter2D(droopPoint, restPoint, bumpPoint);
  const bumpSteerBias = input.bumpSteerBiasM ?? (input.isFront ? 0.0015 : 0.0010);
  const tieInner = PhysicsMath.vec3(
    idealPivot.x,
    idealPivot.y + bumpSteerBias,
    tieOuter.z
  );

  return {
    ...provisional,
    tieRodInnerBody: tieInner,
    tieRodOuterAtRestBody: tieOuter,
    tieRodLengthM: PhysicsMath.vec3Length(PhysicsMath.vec3Sub(tieOuter, tieInner)),
  };
}

function solveBumpSteerAngle(
  geometry: SuspensionCornerGeometry,
  lowerBallJoint: Vec3,
  steeringAxis: Vec3,
  zeroSteerTieOuter: Vec3
): number {
  const error = (angle: number) =>
    PhysicsMath.vec3Length(
      PhysicsMath.vec3Sub(
        rotatePointAroundAxis(zeroSteerTieOuter, lowerBallJoint, steeringAxis, angle),
        geometry.tieRodInnerBody
      )
    ) - geometry.tieRodLengthM;

  const limit = 0.10;
  const sampleCount = 100;
  let bestAngle = 0;
  let bestAbsError = Math.abs(error(0));
  let bracket: [number, number] | null = null;
  let previousAngle = -limit;
  let previousError = error(previousAngle);

  for (let i = 0; i <= sampleCount; i++) {
    const angle = -limit + (2 * limit * i) / sampleCount;
    const currentError = error(angle);
    const absError = Math.abs(currentError);
    if (absError < bestAbsError) {
      bestAbsError = absError;
      bestAngle = angle;
    }
    if (i > 0 && previousError * currentError <= 0) {
      const candidate: [number, number] = [previousAngle, angle];
      const candidateMid = (candidate[0] + candidate[1]) * 0.5;
      if (!bracket || Math.abs(candidateMid) < Math.abs((bracket[0] + bracket[1]) * 0.5)) {
        bracket = candidate;
      }
    }
    previousAngle = angle;
    previousError = currentError;
  }

  if (!bracket) return bestAngle;
  let [low, high] = bracket;
  let lowError = error(low);
  for (let i = 0; i < 36; i++) {
    const mid = (low + high) * 0.5;
    const midError = error(mid);
    if (lowError * midError <= 0) {
      high = mid;
    } else {
      low = mid;
      lowError = midError;
    }
  }
  return (low + high) * 0.5;
}

export function solveSuspensionKinematics(
  geometry: SuspensionCornerGeometry,
  suspensionTravelM: number,
  commandedSteerRad: number
): WheelKinematicPose {
  const travel = PhysicsMath.clamp(
    Number.isFinite(suspensionTravelM) ? suspensionTravelM : 0,
    -geometry.maxDroopM,
    geometry.maxBumpM
  );
  const state = computeUnsteeredState(geometry, travel);
  const physicalCamberRest = -geometry.sideSign * geometry.staticCamberDeg * DEG;
  const physicalCamberNow = -geometry.sideSign * state.camberRad;
  const zeroSteerTieOuter = PhysicsMath.vec3Add(
    state.hub,
    rotateAroundAxis(
      PhysicsMath.vec3Sub(geometry.tieRodOuterAtRestBody, geometry.hubCenterAtRestBody),
      PhysicsMath.vec3(0, 0, 1),
      physicalCamberNow - physicalCamberRest
    )
  );
  const bumpSteerRad = solveBumpSteerAngle(
    geometry,
    state.lower,
    state.axis,
    zeroSteerTieOuter
  );
  const steeringRotation = (Number.isFinite(commandedSteerRad) ? commandedSteerRad : 0) + bumpSteerRad;

  const baseForward = PhysicsMath.vec3(0, 0, 1);
  const baseLateral = rotateAroundAxis(
    PhysicsMath.vec3(1, 0, 0),
    baseForward,
    physicalCamberNow
  );
  const forward = PhysicsMath.vec3Normalize(rotateAroundAxis(baseForward, state.axis, steeringRotation));
  const lateral = PhysicsMath.vec3Normalize(rotateAroundAxis(baseLateral, state.axis, steeringRotation));
  const up = PhysicsMath.vec3Normalize(PhysicsMath.vec3Cross(forward, lateral));
  const headingRad = Math.atan2(forward.x, forward.z);
  const camberDeg = -geometry.sideSign * Math.asin(PhysicsMath.clamp(lateral.y, -1, 1)) * RAD;

  const casterDeg = Math.atan2(-state.axis.z, Math.max(1e-8, state.axis.y)) * RAD;
  const kingpinInclinationDeg = Math.atan2(
    -geometry.sideSign * state.axis.x,
    Math.max(1e-8, state.axis.y)
  ) * RAD;

  const groundY = state.hub.y - geometry.wheelRadiusM;
  const axisY = Math.abs(state.axis.y) > 1e-7 ? state.axis.y : 1e-7;
  const groundT = (groundY - state.lower.y) / axisY;
  const axisGround = PhysicsMath.vec3Add(state.lower, PhysicsMath.vec3Scale(state.axis, groundT));
  const scrubRadiusM = geometry.sideSign * (state.hub.x - axisGround.x);

  return {
    hubCenterBody: state.hub,
    lowerBallJointBody: state.lower,
    upperBallJointBody: state.upper,
    tieRodOuterBody: rotatePointAroundAxis(
      zeroSteerTieOuter,
      state.lower,
      state.axis,
      steeringRotation
    ),
    steeringAxisBody: state.axis,
    forwardBody: forward,
    lateralBody: lateral,
    upBody: up,
    commandedSteerRad: Number.isFinite(commandedSteerRad) ? commandedSteerRad : 0,
    headingRad,
    bumpSteerDeg: bumpSteerRad * RAD,
    camberDeg,
    casterDeg,
    kingpinInclinationDeg,
    scrubRadiusM,
  };
}

export function transformVelocityToKinematicFrame(
  longitudinalVelocity: number,
  lateralVelocity: number,
  headingDeltaRad: number
): { longitudinal: number; lateral: number } {
  const c = Math.cos(headingDeltaRad);
  const s = Math.sin(headingDeltaRad);
  return {
    longitudinal: longitudinalVelocity * c + lateralVelocity * s,
    lateral: lateralVelocity * c - longitudinalVelocity * s,
  };
}

export function transformForceToCommandFrame(
  longitudinalForce: number,
  lateralForce: number,
  headingDeltaRad: number
): { longitudinal: number; lateral: number } {
  const c = Math.cos(headingDeltaRad);
  const s = Math.sin(headingDeltaRad);
  return {
    longitudinal: longitudinalForce * c - lateralForce * s,
    lateral: longitudinalForce * s + lateralForce * c,
  };
}

export function normalizeHeadingDelta(angle: number): number {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

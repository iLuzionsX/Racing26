export interface WheelVisualPoseInput {
  chassisHeaveM: number;
  chassisPitchRad: number;
  chassisRollRad: number;
  mountX: number;
  mountZ: number;
  suspensionTravelM: number;
  tireSquishM: number;
  sidewallDeflectionM: number;
  isLeft: boolean;
  camberRad: number;
  visualWheelRadiusM?: number;
}

export interface WheelVisualPose {
  x: number;
  y: number;
  z: number;
  rotationX: number;
  rotationZ: number;
  mountX: number;
  mountY: number;
  mountZ: number;
  crashAttachmentBlend: number;
}

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
const smoothstep = (edge0: number, edge1: number, value: number) => {
  const t = clamp01((value - edge0) / Math.max(1e-6, edge1 - edge0));
  return t * t * (3 - 2 * t);
};

/**
 * Fallback wheel pose for older/replayed states that do not include an
 * authoritative world-space unsprung hub position. Current live simulation
 * rendering should prefer hubWorldPos from the suspension solver.
 */
export function computeWheelVisualPose(input: WheelVisualPoseInput): WheelVisualPose {
  const pitch = Number.isFinite(input.chassisPitchRad) ? input.chassisPitchRad : 0;
  const roll = Number.isFinite(input.chassisRollRad) ? input.chassisRollRad : 0;
  const x = Number.isFinite(input.mountX) ? input.mountX : 0;
  const z = Number.isFinite(input.mountZ) ? input.mountZ : 0;

  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);
  const cr = Math.cos(roll);
  const sr = Math.sin(roll);

  const rotatedMountX = cr * x;
  const rotatedMountY = cp * sr * x - sp * z;
  const rotatedMountZ = sp * sr * x + cp * z;

  const sidewall = Number.isFinite(input.sidewallDeflectionM) ? input.sidewallDeflectionM : 0;
  const sidewallOffset = input.isLeft ? -sidewall : sidewall;
  const travel = Number.isFinite(input.suspensionTravelM) ? input.suspensionTravelM : 0;
  const squish = Number.isFinite(input.tireSquishM) ? input.tireSquishM : 0;
  const heave = Number.isFinite(input.chassisHeaveM) ? input.chassisHeaveM : 0;
  const radius = Math.max(0.05, input.visualWheelRadiusM ?? 0.33);

  // Normal driving keeps wheels road-oriented. During a wipeout the hub carrier
  // progressively follows the chassis attitude so it cannot visually detach.
  const crashAngle = Math.max(Math.abs(pitch), Math.abs(roll));
  const crashAttachmentBlend = smoothstep(0.35, 0.78, crashAngle);

  return {
    x: rotatedMountX + sidewallOffset,
    y: radius + heave + rotatedMountY + travel - squish,
    z: rotatedMountZ,
    rotationX: pitch * crashAttachmentBlend,
    rotationZ: (input.isLeft ? input.camberRad : -input.camberRad) + roll * crashAttachmentBlend,
    mountX: rotatedMountX,
    mountY: rotatedMountY,
    mountZ: rotatedMountZ,
    crashAttachmentBlend,
  };
}

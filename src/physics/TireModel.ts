import { PhysicsMath } from './math/PhysicsMath';

export interface TireModelConfig {
  baseGrip: number;
  stiffnessB: number;
  loadSensitivity: number;
  slideFrictionMultiplier: number;
  relaxationLength: number;
  longitudinalRelaxationLength?: number;
  longitudinalForceRelaxationLength?: number;
  pneumaticTrailMax: number;
  camberStiffness: number;
  optimalTemp: number;
  basePressurePsi: number;
  sidewallStiffness?: number;
  verticalStiffness?: number;
  referenceLoadN?: number;
  longitudinalGripScale?: number;
  lateralGripScale?: number;
  longitudinalShapeC?: number;
  lateralShapeC?: number;
  longitudinalCurvatureE?: number;
  lateralCurvatureE?: number;
  combinedSlipLongitudinalB?: number;
  combinedSlipLateralB?: number;
  combinedSlipExponent?: number;
}

export interface TireForceOutput {
  fx: number;
  fy: number;
  aligningTorque: number;
  pneumaticTrail: number;
  sidewallDeflection: number;
  tireSquishM: number;
  isSkidding: boolean;
  skidIntensity: number;
  frictionLimit: number;
  gripUtilization: number;
  effectiveMu: number;
  pureFx?: number;
  pureFy?: number;
  longitudinalForceLimit?: number;
  lateralForceLimit?: number;
  combinedSlipExponent?: number;
  combinedSlipUtilization?: number;
}

export interface TireForceInput {
  slipRatio: number;
  slipAngle: number;
  verticalLoad: number;
  camberDeg: number;
  surfaceFriction: number;
  gripScale?: number;
  isLeft?: boolean;
}

const zeroOutput = (): TireForceOutput => ({
  fx: 0,
  fy: 0,
  aligningTorque: 0,
  pneumaticTrail: 0,
  sidewallDeflection: 0,
  tireSquishM: 0,
  isSkidding: false,
  skidIntensity: 0,
  frictionLimit: 0,
  gripUtilization: 0,
  effectiveMu: 0,
  pureFx: 0,
  pureFy: 0,
  longitudinalForceLimit: 0,
  lateralForceLimit: 0,
  combinedSlipExponent: 2,
  combinedSlipUtilization: 0,
});

const magicFormula = (slip: number, b: number, c: number, e: number): number => {
  const bx = b * slip;
  return Math.sin(c * Math.atan(bx - e * (bx - Math.atan(bx))));
};

const combinedEnvelopeUsage = (
  fx: number,
  fy: number,
  longitudinalLimit: number,
  lateralLimit: number,
  exponent: number
): number => {
  if (longitudinalLimit <= 1 || lateralLimit <= 1) return 0;
  const nx = Math.abs(fx) / longitudinalLimit;
  const ny = Math.abs(fy) / lateralLimit;
  return Math.pow(Math.pow(nx, exponent) + Math.pow(ny, exponent), 1 / exponent);
};

/**
 * Load-sensitive, Pacejka-inspired tire model with progressive combined slip.
 *
 * Pure longitudinal and lateral forces are calculated independently using a
 * compact Magic Formula, then coupled with smooth weighting functions and a
 * final superellipse envelope. This preserves progressive trail-braking and
 * power-on corner-exit behavior instead of hard-clamping two independent forces.
 */
export class TireModel {
  public config: TireModelConfig;

  private inferredReferenceLoadN = 3600;
  private referenceLoadAccumulatorN = 0;
  private referenceLoadSamples = 0;

  constructor(config: TireModelConfig) {
    this.config = { ...config };
  }

  public reset() {
    this.inferredReferenceLoadN = this.config.referenceLoadN || 3600;
    this.referenceLoadAccumulatorN = 0;
    this.referenceLoadSamples = 0;
  }

  public calculate(input: TireForceInput): TireForceOutput {
    const fz = Math.max(0, input.verticalLoad);
    if (fz < 5) return zeroOutput();

    // Learn the static corner load only during the initial settling window, then
    // freeze it. Continuously adapting the reference load in a sustained corner
    // would erase the very load sensitivity this model is meant to preserve.
    if (!this.config.referenceLoadN && fz > 500 && fz < 12000 && this.referenceLoadSamples < 240) {
      this.referenceLoadAccumulatorN += fz;
      this.referenceLoadSamples += 1;
      this.inferredReferenceLoadN = this.referenceLoadAccumulatorN / this.referenceLoadSamples;
    }

    const referenceLoad = Math.max(800, this.config.referenceLoadN || this.inferredReferenceLoadN);
    const loadRatio = Math.max(0.08, fz / referenceLoad);
    const loadExponent = PhysicsMath.clamp(this.config.loadSensitivity * referenceLoad, 0, 0.32);
    const loadSensitivityScale = Math.pow(loadRatio, -loadExponent);
    const normalizedStiffnessScale = PhysicsMath.clamp(Math.pow(loadRatio, -0.055), 0.88, 1.12);

    const gripScale = input.gripScale ?? 1;
    const surfaceGrip = Math.max(0.05, input.surfaceFriction);
    const baseMu = Math.max(
      0.05,
      this.config.baseGrip * surfaceGrip * gripScale * loadSensitivityScale
    );
    const longitudinalMu = baseMu * (this.config.longitudinalGripScale ?? 1.0);
    const lateralMu = baseMu * (this.config.lateralGripScale ?? 1.0);

    const kappa = PhysicsMath.clamp(input.slipRatio, -3, 3);
    const alpha = PhysicsMath.clamp(input.slipAngle, -1.2, 1.2);

    const bx = Math.max(1.0, this.config.stiffnessB * 0.95 * normalizedStiffnessScale);
    const by = Math.max(1.0, this.config.stiffnessB * 0.82 * normalizedStiffnessScale);
    const cx = PhysicsMath.clamp(this.config.longitudinalShapeC ?? 1.65, 1.1, 2.0);
    const cy = PhysicsMath.clamp(this.config.lateralShapeC ?? 1.60, 1.1, 2.0);
    const ex = PhysicsMath.clamp(this.config.longitudinalCurvatureE ?? 0.45, -0.5, 0.95);
    const ey = PhysicsMath.clamp(this.config.lateralCurvatureE ?? 0.25, -0.5, 0.95);

    const longitudinalPeak = longitudinalMu * fz;
    const lateralPeak = lateralMu * fz;
    const pureFx = longitudinalPeak * magicFormula(kappa, bx, cx, ex);
    let pureFy = lateralPeak * magicFormula(alpha, by, cy, ey);

    // Negative camber leans each tire toward the vehicle center. In the canonical
    // +X-left wheel frame that means a negative camber-thrust contribution on left
    // tires and a positive contribution on right tires. Mirror geometry, not force,
    // across the centerline so equal static camber cancels instead of pushing outward.
    const signedCamber = (input.isLeft ? 1 : -1) * input.camberDeg;
    const camberThrust = PhysicsMath.clamp(
      signedCamber * this.config.camberStiffness * Math.pow(loadRatio, 0.75),
      -lateralPeak * 0.10,
      lateralPeak * 0.10
    );
    pureFy += camberThrust;

    // MF-style combined-slip weighting: steering progressively consumes Fx and
    // drive/brake slip progressively consumes Fy before the safety envelope binds.
    const bXAlpha = Math.max(0.5, this.config.combinedSlipLongitudinalB ?? 4.5);
    const bYKappa = Math.max(0.5, this.config.combinedSlipLateralB ?? 4.0);
    const tanAlpha = Math.tan(PhysicsMath.clamp(alpha, -0.75, 0.75));
    const gXAlpha = Math.cos(Math.atan(bXAlpha * Math.abs(tanAlpha)));
    const gYKappa = Math.cos(Math.atan(bYKappa * Math.abs(kappa)));

    let fx = pureFx * gXAlpha;
    let fy = pureFy * gYKappa;

    // Beyond peak slip, transition to a lower sliding coefficient. Using the
    // maximum severity means a locked/spinning tire also sheds cornering capacity.
    const longSeverity = Math.abs(kappa) / 0.13;
    const latSeverity = Math.abs(alpha) / 0.14;
    const slipSeverity = Math.max(longSeverity, latSeverity);
    const slideBlendLinear = PhysicsMath.clamp((slipSeverity - 1.15) / 2.35, 0, 1);
    const slideBlend = slideBlendLinear * slideBlendLinear * (3 - 2 * slideBlendLinear);
    const slideScale = PhysicsMath.lerp(
      1.0,
      PhysicsMath.clamp(this.config.slideFrictionMultiplier, 0.45, 1.0),
      slideBlend
    );
    fx *= slideScale;
    fy *= slideScale;

    const longitudinalForceLimit = Math.max(1, longitudinalPeak * slideScale);
    const lateralForceLimit = Math.max(1, lateralPeak * slideScale);
    const combinedSlipExponent = PhysicsMath.clamp(this.config.combinedSlipExponent ?? 2.15, 1.6, 3.0);

    // Superellipse safety envelope. Progressive weighting above does the driving;
    // this only prevents numerical/transient overshoot beyond available friction.
    let combinedSlipUtilization = combinedEnvelopeUsage(
      fx,
      fy,
      longitudinalForceLimit,
      lateralForceLimit,
      combinedSlipExponent
    );
    if (combinedSlipUtilization > 1) {
      const scale = 1 / combinedSlipUtilization;
      fx *= scale;
      fy *= scale;
      combinedSlipUtilization = 1;
    }

    const gripUtilization = PhysicsMath.clamp(combinedSlipUtilization, 0, 1.5);

    // Pneumatic trail rises with load slightly, then falls with slip and saturation.
    // This lets steering torque soften naturally as the front tires pass their peak.
    const trailSlipFalloff = 1 / (1 + Math.pow(Math.abs(alpha) / 0.14, 1.75));
    const trailSaturationFalloff = 1 - 0.62 * Math.pow(PhysicsMath.clamp(gripUtilization, 0, 1), 1.7);
    const trailLoadScale = PhysicsMath.clamp(Math.pow(loadRatio, 0.08), 0.85, 1.18);
    const pneumaticTrail = Math.max(
      0,
      this.config.pneumaticTrailMax * trailSlipFalloff * trailSaturationFalloff * trailLoadScale
    );
    const aligningTorque = -fy * pneumaticTrail;

    const sidewallStiffness = Math.max(40000, this.config.sidewallStiffness || 180000);
    const verticalStiffness = Math.max(90000, this.config.verticalStiffness || 240000);
    const sidewallDeflection = PhysicsMath.clamp(fy / sidewallStiffness, -0.045, 0.045);
    const tireSquishM = PhysicsMath.clamp(fz / verticalStiffness, 0, 0.055);

    const frictionLimit = Math.max(longitudinalForceLimit, lateralForceLimit);
    const skidOnSlip = slipSeverity > 1.25 && gripUtilization > 0.72;
    const skidOnSaturation = gripUtilization > 0.985 && slipSeverity > 0.85;

    return {
      fx,
      fy,
      aligningTorque,
      pneumaticTrail,
      sidewallDeflection,
      tireSquishM,
      isSkidding: skidOnSlip || skidOnSaturation,
      skidIntensity: PhysicsMath.clamp(
        Math.max((slipSeverity - 0.85) / 2.5, (gripUtilization - 0.82) / 0.18),
        0,
        1
      ),
      frictionLimit,
      gripUtilization,
      effectiveMu: baseMu,
      pureFx,
      pureFy,
      longitudinalForceLimit,
      lateralForceLimit,
      combinedSlipExponent,
      combinedSlipUtilization,
    };
  }
}

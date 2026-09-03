import { PhysicsMath } from '../math/PhysicsMath';
import type { ISurfaceProvider, SurfaceSample } from '../SurfaceProvider';

export type ValidationSurfaceKind =
  | 'flat'
  | 'bump-full'
  | 'bump-left'
  | 'bump-right'
  | 'split-mu';

export interface ValidationSurfaceOptions {
  kind?: ValidationSurfaceKind;
  friction?: number;
  rollingResistance?: number;
  gradeDeg?: number;
  wetness?: number;
  bumpStartZ?: number;
  bumpLengthM?: number;
  bumpHeightM?: number;
  splitMuLeft?: number;
  splitMuRight?: number;
}

/**
 * Deterministic proving-ground surface used only to prescribe road geometry and
 * material properties. It never modifies vehicle forces directly; the normal
 * simulation still resolves tire, suspension, chassis and driveline response.
 */
export class ValidationSurfaceProvider implements ISurfaceProvider {
  public readonly options: Required<ValidationSurfaceOptions>;

  constructor(options: ValidationSurfaceOptions = {}) {
    this.options = {
      kind: options.kind ?? 'flat',
      friction: options.friction ?? 1.0,
      rollingResistance: options.rollingResistance ?? 0.015,
      gradeDeg: options.gradeDeg ?? 0,
      wetness: options.wetness ?? 0,
      bumpStartZ: options.bumpStartZ ?? 20,
      bumpLengthM: options.bumpLengthM ?? 0.55,
      bumpHeightM: options.bumpHeightM ?? 0.025,
      splitMuLeft: options.splitMuLeft ?? 1.0,
      splitMuRight: options.splitMuRight ?? 0.45,
    };
  }

  private bumpContribution(x: number, z: number): { height: number; dz: number } {
    const {
      kind,
      bumpStartZ,
      bumpLengthM,
      bumpHeightM,
    } = this.options;

    if (!kind.startsWith('bump-')) return { height: 0, dz: 0 };

    const sideAllowed =
      kind === 'bump-full' ||
      (kind === 'bump-left' && x > 0) ||
      (kind === 'bump-right' && x < 0);
    if (!sideAllowed) return { height: 0, dz: 0 };

    const length = Math.max(0.02, bumpLengthM);
    const u = (z - bumpStartZ) / length;
    if (u < 0 || u > 1) return { height: 0, dz: 0 };

    // Smooth raised-cosine bump: zero height/slope at both ends, no discontinuity.
    const height = 0.5 * bumpHeightM * (1 - Math.cos(2 * Math.PI * u));
    const dz = (Math.PI * bumpHeightM / length) * Math.sin(2 * Math.PI * u);
    return { height, dz };
  }

  public sampleSurface(x: number, z: number): SurfaceSample {
    const gradeRad = this.options.gradeDeg * Math.PI / 180;
    const gradeSlope = Math.tan(gradeRad);
    const bump = this.bumpContribution(x, z);
    const totalSlopeDz = gradeSlope + bump.dz;

    let friction = this.options.friction;
    if (this.options.kind === 'split-mu') {
      friction = x >= 0 ? this.options.splitMuLeft : this.options.splitMuRight;
    }

    const normal = PhysicsMath.vec3Normalize(
      PhysicsMath.vec3(0, 1, -totalSlopeDz)
    );

    return {
      elevation: gradeSlope * z + bump.height,
      normal,
      slopePitch: Math.atan(totalSlopeDz),
      slopeRoll: 0,
      type: this.options.wetness > 0.1 ? 'wet' : 'asphalt',
      friction,
      rollingResistance: this.options.rollingResistance,
      wetness: this.options.wetness,
      isKerbRumble: false,
    } as SurfaceSample;
  }
}

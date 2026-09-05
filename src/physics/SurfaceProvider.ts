import { SurfaceType } from '../types';
import { Vec3, PhysicsMath } from './math/PhysicsMath';

export interface SurfaceSample {
  elevation: number;
  normal: Vec3;
  slopePitch: number;
  slopeRoll: number;
  type: SurfaceType;
  friction: number;
  rollingResistance: number;
  wetness: number;
  isKerbRumble: boolean;
}

export interface ISurfaceProvider {
  sampleSurface(x: number, z: number): SurfaceSample;
}

/**
 * Completely flat proving-ground surface.
 *
 * Elevation, pitch and roll are always zero. The rendered proving ground is one
 * continuous asphalt plane except for the visibly distinct wet skidpad and the
 * marked dry/racing-line areas, so physics must not introduce invisible gravel,
 * marbles, or kerb bands simply because a crash pushes the car sideways.
 */
export class ProvingGroundSurfaceProvider implements ISurfaceProvider {
  public sampleSurface(x: number, z: number): SurfaceSample {
    const elevation = 0;
    const slopePitch = 0;
    const slopeRoll = 0;

    let type: SurfaceType = 'asphalt';
    let friction = 1.0;
    let rollingResistance = 0.015;
    let wetness = 0.0;

    // Wet / polished concrete skidpad.
    const distToWet = Math.hypot(x - 85, z + 60);
    if (distToWet <= 76) {
      type = 'wet';
      friction = 0.42;
      rollingResistance = 0.012;
      wetness = 0.85;
    } else {
      // Dry high-grip skidpad.
      const distToDry = Math.hypot(x + 85, z - 60);
      if (distToDry <= 76) {
        type = 'racing_line';
        friction = 1.14;
        rollingResistance = 0.018;
      } else if (Math.abs(z) <= 510 && Math.abs(x) <= 6.5) {
        // The marked center runway is the only longitudinal high-grip strip.
        // Everything outside it remains ordinary asphalt because that is what the
        // player actually sees on the flat proving-ground mesh. Low-grip runoff and
        // gravel still exist on the Showcase Circuit, where they are visibly drawn.
        type = 'racing_line';
        friction = 1.10;
        rollingResistance = 0.016;
      }
    }

    return {
      elevation,
      normal: PhysicsMath.vec3(0, 1, 0),
      slopePitch,
      slopeRoll,
      type,
      friction,
      rollingResistance,
      wetness,
      isKerbRumble: false,
    };
  }
}

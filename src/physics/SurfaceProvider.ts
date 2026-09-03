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
 * Elevation, pitch and roll are always zero. This keeps suspension and tire
 * validation isolated from hidden hills, crests, dips, banking and bumps while
 * retaining the existing material/friction zones for grip testing.
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
      } else if (Math.abs(z) <= 510) {
        // Main runway: grip zones only. Every zone remains at exactly Y = 0.
        const absX = Math.abs(x);
        if (absX <= 6.5) {
          type = 'racing_line';
          friction = 1.10;
          rollingResistance = 0.016;
        } else if (absX <= 17.5) {
          type = 'asphalt';
          friction = 1.0;
          rollingResistance = 0.015;
        } else if (absX <= 20.0) {
          // Keep the lower-grip kerb material band, but remove its former 45 mm rise.
          type = 'kerb';
          friction = 0.88;
          rollingResistance = 0.024;
        } else if (absX <= 24.5) {
          type = 'marbles';
          friction = 0.72;
          rollingResistance = 0.035;
        } else {
          type = 'gravel';
          friction = 0.55;
          rollingResistance = 0.075;
        }
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

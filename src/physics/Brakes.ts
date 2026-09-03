import { PhysicsMath } from './math/PhysicsMath';

export interface BrakesConfig {
  maxBrakeTorque: number; // Nm (e.g. 3800 Nm)
  handbrakeTorque: number; // Nm (e.g. 2600 Nm)
  frontBias: number; // e.g. 0.62 = 62% front
}

export class BrakeSystem {
  public config: BrakesConfig;

  // Independent hydraulic pressure modulators (0..1) controlled by ABS
  public pressureModulators: [number, number, number, number] = [1, 1, 1, 1];

  constructor(config: BrakesConfig) {
    this.config = { ...config };
  }

  /**
   * Compute per-wheel hydraulic and mechanical braking torques
   *
   * @param brakeInput 0 to 1
   * @param handbrake boolean
   */
  public calculateBrakeTorques(
    brakeInput: number,
    handbrake: boolean
  ): {
    hydraulicTorques: [number, number, number, number];
    handbrakeTorques: [number, number, number, number];
  } {
    const totalCommandedTorque = brakeInput * this.config.maxBrakeTorque;

    const frontPerWheel = (totalCommandedTorque * this.config.frontBias * 0.5);
    const rearPerWheel = (totalCommandedTorque * (1.0 - this.config.frontBias) * 0.5);

    // Apply ABS pressure modulator multipliers
    const hydraulicTorques: [number, number, number, number] = [
      frontPerWheel * this.pressureModulators[0],
      frontPerWheel * this.pressureModulators[1],
      rearPerWheel * this.pressureModulators[2],
      rearPerWheel * this.pressureModulators[3],
    ];

    const hbTorqueRear = handbrake ? this.config.handbrakeTorque * 0.5 : 0;
    const handbrakeTorques: [number, number, number, number] = [
      0,
      0,
      hbTorqueRear,
      hbTorqueRear,
    ];

    return {
      hydraulicTorques,
      handbrakeTorques,
    };
  }
}

import { Vec3, PhysicsMath } from './math/PhysicsMath';

export interface AeroConfig {
  downforceFront100Kmh: number; // N at 100 km/h (e.g. 240 N)
  downforceRear100Kmh: number; // N at 100 km/h (e.g. 380 N)
  dragCoeff: number; // Cd * Area (e.g. 0.32)
  copPitchSensitivity: number; // CoP shift per degree pitch dive
  groundEffectUnderbody: boolean;
  groundEffectMaxDownforce: number; // N at 100 km/h (e.g. 420 N)
  diffuserStallHeight: number; // meters (e.g. 0.035m)
  drsEnabled: boolean;
  drsDragReduction: number; // e.g. 0.35
  drsDownforceReduction: number; // e.g. 0.45
  airbrakeEnabled: boolean;
}

export class AerodynamicsSystem {
  public config: AeroConfig;
  public drsActive: boolean = false;
  public airbrakeActive: boolean = false;
  public diffuserStalled: boolean = false;
  public totalDownforceN: number = 0;
  public totalDragN: number = 0;
  public diffuserRideHeightM: number = 0.12;

  constructor(config: AeroConfig) {
    this.config = { ...config };
  }

  public toggleDrs() {
    if (this.config.drsEnabled) {
      this.drsActive = !this.drsActive;
    }
  }

  /**
   * Calculate aerodynamic forces in body coordinates
   *
   * @param localVelocity Chassis velocity in local coordinates (vx, vy, vz)
   * @param pitchRad Chassis pitch angle in radians (positive = nose up, negative = nose dive)
   * @param underbodyGroundClearance Lowest underbody clearance to road surface in meters
   * @param brakeInput 0 to 1
   * @param wheelbase Wheelbase in meters
   */
  public calculateAeroForces(
    localVelocity: Vec3,
    pitchRad: number,
    underbodyGroundClearance: number,
    brakeInput: number,
    wheelbase: number
  ): {
    frontAeroForce: Vec3;
    rearAeroForce: Vec3;
    diffuserAeroForce: Vec3;
    dragForce: Vec3;
    frontPointBody: Vec3;
    rearPointBody: Vec3;
    diffuserPointBody: Vec3;
  } {
    const forwardSpeed = localVelocity.z;
    const speedSq = forwardSpeed * forwardSpeed;
    const speedFactor = speedSq / Math.pow(100 / 3.6, 2); // Normalized relative to 100 km/h (27.78 m/s)

    this.diffuserRideHeightM = Math.max(0.005, underbodyGroundClearance);

    // Active Airbrake Trigger: heavy brake at speeds > 80 km/h (22.2 m/s)
    if (this.config.airbrakeEnabled && brakeInput > 0.65 && forwardSpeed > 22.0) {
      this.airbrakeActive = true;
      if (this.drsActive) this.drsActive = false; // Auto close DRS on airbrake
    } else {
      this.airbrakeActive = false;
    }

    // Drag multiplier
    let effectiveDragCd = this.config.dragCoeff;
    if (this.drsActive) {
      effectiveDragCd *= (1.0 - this.config.drsDragReduction);
    }
    if (this.airbrakeActive) {
      effectiveDragCd *= 2.1; // Huge air resistance when wing flips up
    }

    // Aerodynamic Drag Force (air density ~1.225 kg/m^3)
    const airDensity = 1.225;
    const dragMagnitude = 0.5 * airDensity * effectiveDragCd * (2.2) * (speedSq) * Math.sign(forwardSpeed);
    this.totalDragN = Math.abs(dragMagnitude);
    const dragForce = PhysicsMath.vec3(0, 0, -dragMagnitude);

    // Downforce Calculations
    let dfFront = this.config.downforceFront100Kmh * speedFactor;
    let dfRear = this.config.downforceRear100Kmh * speedFactor;

    // Pitch sensitivity: dive shifts CoP forward
    const pitchDeg = (pitchRad * 180) / Math.PI;
    const copShift = -pitchDeg * this.config.copPitchSensitivity;
    dfFront *= (1.0 + copShift);
    dfRear *= (1.0 - copShift);

    if (this.drsActive) {
      dfRear *= (1.0 - this.config.drsDownforceReduction);
    }
    if (this.airbrakeActive) {
      dfRear *= 1.45; // High rear downforce in airbrake mode
    }

    // Ground-Effect Venturi Underbody Diffuser
    let diffuserDownforce = 0;
    if (this.config.groundEffectUnderbody && speedFactor > 0.05) {
      if (this.diffuserRideHeightM <= this.config.diffuserStallHeight) {
        // Underbody diffuser stalls from bottoming out (flow detached)
        this.diffuserStalled = true;
        diffuserDownforce = this.config.groundEffectMaxDownforce * speedFactor * 0.15;
      } else {
        this.diffuserStalled = false;
        // Ground effect suction increases inversely with ride height: 1 / sqrt(h / h_nom)
        const nominalHeight = 0.12;
        const groundProximitySuction = Math.sqrt(nominalHeight / this.diffuserRideHeightM);
        diffuserDownforce = this.config.groundEffectMaxDownforce * speedFactor * Math.min(2.2, groundProximitySuction);
      }
    }

    this.totalDownforceN = dfFront + dfRear + diffuserDownforce;

    // Application points in body coords:
    // Front axle at z = +wheelbase * 0.5
    // Rear axle at z = -wheelbase * 0.5
    // Diffuser center at z = -wheelbase * 0.2
    const frontPointBody = PhysicsMath.vec3(0, 0.2, wheelbase * 0.5);
    const rearPointBody = PhysicsMath.vec3(0, 0.7, -wheelbase * 0.5);
    const diffuserPointBody = PhysicsMath.vec3(0, 0.05, -wheelbase * 0.2);

    const frontAeroForce = PhysicsMath.vec3(0, -dfFront, 0);
    const rearAeroForce = PhysicsMath.vec3(0, -dfRear, 0);
    const diffuserAeroForce = PhysicsMath.vec3(0, -diffuserDownforce, 0);

    return {
      frontAeroForce,
      rearAeroForce,
      diffuserAeroForce,
      dragForce,
      frontPointBody,
      rearPointBody,
      diffuserPointBody,
    };
  }
}

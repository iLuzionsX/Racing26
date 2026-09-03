import { VehicleState, WheelState, PerformanceTimerState, SurfaceType } from '../types';
import { Vec3, PhysicsMath } from './math/PhysicsMath';

export class TelemetrySystem {
  public performanceTimer: PerformanceTimerState;
  public gForceHistory: { lat: number; long: number }[] = [];
  public driftScore: number = 0;
  private gHistoryTimer: number = 0;

  constructor() {
    this.performanceTimer = {
      zeroToSixtyTime: null,
      zeroToHundredKmhTime: null,
      quarterMileTime: null,
      quarterMileSpeedKmh: null,
      peakLateralG: 0,
      currentSprintStart: null,
      currentSprintDistance: 0,
      isTimingSprint: false,
      lastCompletedSprintTime: null,
    };
  }

  public reset() {
    this.performanceTimer = {
      zeroToSixtyTime: null,
      zeroToHundredKmhTime: null,
      quarterMileTime: null,
      quarterMileSpeedKmh: null,
      peakLateralG: 0,
      currentSprintStart: null,
      currentSprintDistance: 0,
      isTimingSprint: false,
      lastCompletedSprintTime: null,
    };
    this.gForceHistory = [];
    this.driftScore = 0;
    this.gHistoryTimer = 0;
  }

  /**
   * Update performance timers deterministically using simulation time
   *
   * @param speedKmh Current speed in km/h
   * @param speedMs Current speed in m/s
   * @param lateralG Current lateral G-force
   * @param longitudinalG Current longitudinal G-force
   * @param throttle Throttle input
   * @param simTime Total accumulated simulation time (seconds)
   * @param dt Timestep (s)
   */
  public updateTimersAndGForces(
    speedKmh: number,
    speedMs: number,
    lateralG: number,
    longitudinalG: number,
    throttle: number,
    simTime: number,
    dt: number
  ) {
    // Peak Lateral G
    const absLatG = Math.abs(lateralG);
    if (absLatG > this.performanceTimer.peakLateralG) {
      this.performanceTimer.peakLateralG = absLatG;
    }

    // Sprint Timers
    if (!this.performanceTimer.isTimingSprint) {
      // Launch trigger: from near stand-still with throttle
      if (speedKmh < 1.0 && throttle > 0.5) {
        this.performanceTimer.isTimingSprint = true;
        this.performanceTimer.currentSprintStart = simTime;
        this.performanceTimer.currentSprintDistance = 0;
        this.performanceTimer.zeroToSixtyTime = null;
        this.performanceTimer.zeroToHundredKmhTime = null;
        this.performanceTimer.quarterMileTime = null;
      }
    } else if (this.performanceTimer.currentSprintStart !== null) {
      const elapsed = simTime - this.performanceTimer.currentSprintStart;
      this.performanceTimer.currentSprintDistance += speedMs * dt;

      // 0-60 MPH (~96.56 km/h)
      if (speedKmh >= 96.56 && this.performanceTimer.zeroToSixtyTime === null) {
        this.performanceTimer.zeroToSixtyTime = elapsed;
      }

      // 0-100 km/h
      if (speedKmh >= 100.0 && this.performanceTimer.zeroToHundredKmhTime === null) {
        this.performanceTimer.zeroToHundredKmhTime = elapsed;
      }

      // 1/4 Mile (402.336 meters)
      if (this.performanceTimer.currentSprintDistance >= 402.34 && this.performanceTimer.quarterMileTime === null) {
        this.performanceTimer.quarterMileTime = elapsed;
        this.performanceTimer.quarterMileSpeedKmh = speedKmh;
        this.performanceTimer.isTimingSprint = false;
        this.performanceTimer.lastCompletedSprintTime = elapsed;
      }

      // Reset if car stops
      if (speedKmh < 1.0 && elapsed > 2.0) {
        this.performanceTimer.isTimingSprint = false;
      }
    }

    // Rolling G-G Friction Circle History (up to 45 samples)
    this.gHistoryTimer += dt;
    if (this.gHistoryTimer >= 0.04) {
      this.gHistoryTimer = 0;
      this.gForceHistory.push({ lat: lateralG, long: longitudinalG });
      if (this.gForceHistory.length > 45) {
        this.gForceHistory.shift();
      }
    }
  }

  /**
   * Compute drift angle and scoring
   */
  public updateDriftScore(
    speedKmh: number,
    localVx: number,
    localVz: number,
    dt: number
  ): { driftAngleDeg: number; isDrifting: boolean } {
    let driftAngleDeg = 0;
    let isDrifting = false;

    if (speedKmh > 18 && Math.abs(localVz) > 3.0) {
      const angleRad = Math.atan2(localVx, Math.abs(localVz));
      driftAngleDeg = (angleRad * 180) / Math.PI;

      if (Math.abs(driftAngleDeg) > 12.0) {
        isDrifting = true;
        // Drift points accumulate with angle and speed
        const speedBonus = speedKmh / 60;
        const angleBonus = Math.abs(driftAngleDeg) / 30;
        this.driftScore += 100 * speedBonus * angleBonus * dt;
      }
    }

    return { driftAngleDeg, isDrifting };
  }

  /**
   * Compute F1 Shift light stage (0: off, 1: green, 2: yellow, 3: red, 4: flash blue)
   */
  public getShiftLightStage(rpm: number, maxRpm: number, revLimiterRpm: number): 0 | 1 | 2 | 3 | 4 {
    const ratio = rpm / maxRpm;
    if (rpm >= revLimiterRpm * 0.98) return 4;
    if (ratio >= 0.92) return 3;
    if (ratio >= 0.84) return 2;
    if (ratio >= 0.76) return 1;
    return 0;
  }
}

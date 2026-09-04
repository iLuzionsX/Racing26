import { AssistMode } from '../types';
import { PhysicsMath } from './math/PhysicsMath';

export interface DriverAidsConfig {
  absMode: AssistMode;
  tcsMode: AssistMode;
  wheelbase: number;
  trackWidth: number;
  ackermannRatio: number;
  maxSteerAngle: number;
  steerSpeed: number;
  steerSpeedReduction: number;
  tcsSportSlipThreshold?: number;
  tcsFullSlipThreshold?: number;
  tcsSportResponse?: number;
  tcsFullResponse?: number;
  tcsSportGain?: number;
  tcsFullGain?: number;
}

export class DriverAidsSystem {
  public config: DriverAidsConfig;

  private absPressureStates: [number, number, number, number] = [1, 1, 1, 1];
  private absHoldTimers: [number, number, number, number] = [0, 0, 0, 0];
  public absActive: boolean = false;

  public tcsActive: boolean = false;
  private tcsThrottleReduction: number = 0;

  // Slip-ratio sign reverses when the car travels in reverse. Keep a persistent
  // motion-direction estimate from wheel rotation so ABS/TCS can reason in a
  // direction-normalized convention: + = driven wheelspin, - = braking lock.
  private motionDirectionSign: 1 | -1 = 1;

  public currentCenterSteerAngle: number = 0;

  constructor(config: DriverAidsConfig) {
    this.config = { ...config };
  }

  public reset() {
    this.absPressureStates = [1, 1, 1, 1];
    this.absHoldTimers = [0, 0, 0, 0];
    this.absActive = false;
    this.tcsActive = false;
    this.tcsThrottleReduction = 0;
    this.motionDirectionSign = 1;
    this.currentCenterSteerAngle = 0;
  }

  private updateMotionDirectionFromWheels(wheelAngularVelocities: number[]) {
    if (wheelAngularVelocities.length === 0) return;
    const averageOmega = wheelAngularVelocities.reduce((sum, omega) => sum + omega, 0) /
      wheelAngularVelocities.length;
    if (Math.abs(averageOmega) > 0.35) {
      this.motionDirectionSign = averageOmega < 0 ? -1 : 1;
    }
  }

  private normalizedTravelSlip(slipRatio: number): number {
    return slipRatio * this.motionDirectionSign;
  }

  public updateSteering(
    steerInput: number,
    forwardSpeedMs: number,
    dt: number
  ): { steerFL: number; steerFR: number; centerAngle: number } {
    // The steering rack has a physical travel limit, not a hidden speed-dependent
    // angle limit. Previous code progressively removed up to steerSpeedReduction of
    // available road-wheel angle as speed rose. That made a genuine oversteer catch
    // impossible at sufficiently high speed even when the driver requested full
    // opposite lock. Speed may affect steering effort/ratio in a real car, but it
    // does not teleport the mechanical rack stops inward. Keep the full physical
    // rack range available and let tire saturation determine whether a steering
    // command actually produces more lateral force.
    void forwardSpeedMs;
    const maxAllowedAngle = this.config.maxSteerAngle;

    // Canonical vehicle coordinates are right-handed: +X is vehicle-left, +Y is up, +Z is forward.
    // UI/control convention: positive steer means LEFT, negative steer means RIGHT.
    // Numeric safety: non-finite driver input must hold the rack instead of poisoning
    // persistent steering state. Finite inputs follow the identical path as before.
    const safeSteerInput = Number.isFinite(steerInput) ? steerInput : 0;
    if (!Number.isFinite(this.currentCenterSteerAngle)) this.currentCenterSteerAngle = 0;
    const targetCenterAngle = safeSteerInput * maxAllowedAngle;

    let steerStep = 0;
    if (Number.isFinite(dt) && dt > 0) {
      const candidateStep = this.config.steerSpeed * dt;
      if (Number.isFinite(candidateStep) && candidateStep >= 0) steerStep = candidateStep;
    }
    if (!Number.isFinite(targetCenterAngle)) {
      // Hold current rack; Ackermann below uses the held center angle.
    } else if (Math.abs(targetCenterAngle - this.currentCenterSteerAngle) <= steerStep) {
      this.currentCenterSteerAngle = targetCenterAngle;
    } else {
      this.currentCenterSteerAngle += Math.sign(targetCenterAngle - this.currentCenterSteerAngle) * steerStep;
    }

    const delta = this.currentCenterSteerAngle;
    if (Math.abs(delta) < 1e-4) return { steerFL: 0, steerFR: 0, centerAngle: 0 };

    const L = this.config.wheelbase;
    const W = this.config.trackWidth;
    const tanDelta = Math.tan(Math.abs(delta));

    let deltaInner = Math.atan((L * tanDelta) / Math.max(0.1, L - 0.5 * W * tanDelta));
    let deltaOuter = Math.atan((L * tanDelta) / Math.max(0.1, L + 0.5 * W * tanDelta));

    deltaInner = PhysicsMath.lerp(Math.abs(delta), deltaInner, this.config.ackermannRatio);
    deltaOuter = PhysicsMath.lerp(Math.abs(delta), deltaOuter, this.config.ackermannRatio);

    // Ackermann: the wheel on the inside of the turn must steer MORE than the outside wheel.
    // Positive steer is LEFT, so FL is the inside wheel. Negative steer is RIGHT, so FR is inside.
    const steerFL = delta > 0 ? deltaInner : -deltaOuter;
    const steerFR = delta > 0 ? deltaOuter : -deltaInner;
    return { steerFL, steerFR, centerAngle: this.currentCenterSteerAngle };
  }

  /**
   * Four-channel slip-regulating ABS.
   *
   * ABS regulates normally at road speed, then its pressure-release authority is
   * phased out smoothly through the final low-speed braking region. The old hard
   * cutoff snapped every channel straight back to full pressure while wheel and
   * driveline states were still dynamic, which could excite a brake limit cycle.
   * The phase-out must also begin before converter creep and ABS release can form a
   * stable crawl-speed plateau; the service brake owns the final stop.
   */
  public updateABS(
    wheelSlipRatios: [number, number, number, number],
    wheelAngularVelocities: [number, number, number, number],
    speedMs: number,
    isBraking: boolean,
    dt: number
  ): [number, number, number, number] {
    this.updateMotionDirectionFromWheels(wheelAngularVelocities);
    const speedMagnitude = Math.abs(speedMs);

    if (this.config.absMode === 'OFF' || !isBraking) {
      this.absActive = false;
      this.absPressureStates = [1, 1, 1, 1];
      this.absHoldTimers = [0, 0, 0, 0];
      return this.absPressureStates;
    }

    // Begin withdrawing pressure-release authority below ~10.8 km/h and finish
    // by ~4.5 km/h. This is a smooth handoff, not an extra brake multiplier: the
    // output simply approaches the driver's unmodulated service-brake request.
    // Starting the handoff above the former ~8 km/h equilibrium prevents ABS and
    // closed-throttle driveline creep from sustaining each other indefinitely.
    const lowSpeedCutoutMs = 1.25;
    const fullAuthorityMs = 3.00;
    const authorityLinear = PhysicsMath.clamp(
      (speedMagnitude - lowSpeedCutoutMs) / (fullAuthorityMs - lowSpeedCutoutMs),
      0,
      1
    );
    const lowSpeedAuthority = authorityLinear * authorityLinear * (3 - 2 * authorityLinear);

    if (lowSpeedAuthority <= 1e-5) {
      this.absActive = false;
      this.absPressureStates = [1, 1, 1, 1];
      this.absHoldTimers = [0, 0, 0, 0];
      return this.absPressureStates;
    }

    const isSport = this.config.absMode === 'SPORT';
    const targetSlip = isSport ? 0.145 : 0.125;
    const deadband = isSport ? 0.018 : 0.015;
    const minPressure = isSport ? 0.34 : 0.30;
    let anyIntervention = false;

    for (let i = 0; i < 4; i++) {
      const normalizedSlip = this.normalizedTravelSlip(wheelSlipRatios[i]);
      const slipMag = Math.max(0, -normalizedSlip);
      const nearLock = speedMagnitude > 3.0 && Math.abs(wheelAngularVelocities[i]) < 0.35;
      const effectiveSlip = nearLock ? Math.max(slipMag, 0.9) : slipMag;
      let regulatedPressure = this.absPressureStates[i];

      if (effectiveSlip > 0.34) {
        const deepLockRate = isSport ? 7.2 : 8.0;
        regulatedPressure = Math.max(minPressure, regulatedPressure - deepLockRate * dt);
      } else if (effectiveSlip > targetSlip + deadband) {
        const over = effectiveSlip - (targetSlip + deadband);
        const releaseRate = (isSport ? 1.55 : 1.85) + Math.min(1.8, over * 5.0);
        regulatedPressure = Math.max(minPressure, regulatedPressure - releaseRate * dt);
      } else if (effectiveSlip < targetSlip - deadband) {
        const under = (targetSlip - deadband) - effectiveSlip;
        const reapplyRate = (isSport ? 6.5 : 7.2) + Math.min(3.0, under * 18.0);
        regulatedPressure = Math.min(1.0, regulatedPressure + reapplyRate * dt);
      }

      // Low-speed phase-out only removes ABS release authority. It never reduces
      // the driver's requested brake pressure. As speed falls, output pressure
      // therefore approaches 1.0 monotonically instead of jumping at a threshold.
      const outputPressure = PhysicsMath.lerp(1.0, regulatedPressure, lowSpeedAuthority);
      this.absPressureStates[i] = outputPressure;
      this.absHoldTimers[i] = 0;
      anyIntervention = anyIntervention || outputPressure < 0.995;
    }

    this.absActive = anyIntervention;
    return this.absPressureStates;
  }

  public updateTCS(
    drivenWheelSlipRatios: number[],
    dt: number
  ): { throttleMultiplier: number; tcsActive: boolean } {
    if (this.config.tcsMode === 'OFF') {
      this.tcsActive = false;
      this.tcsThrottleReduction = 0;
      return { throttleMultiplier: 1.0, tcsActive: false };
    }

    const isSport = this.config.tcsMode === 'SPORT';
    const tcsThreshold = isSport
      ? (this.config.tcsSportSlipThreshold ?? 0.19)
      : (this.config.tcsFullSlipThreshold ?? 0.12);
    // The last wheel-rotation direction is updated every ABS pass, including when
    // ABS itself is inactive. This makes reverse wheelspin normalize to positive
    // drive slip while ordinary forward braking stays negative and does not trigger TCS.
    const maxSlip = Math.max(
      0,
      ...drivenWheelSlipRatios.map((slip) => this.normalizedTravelSlip(slip))
    );

    if (maxSlip > tcsThreshold) {
      const excess = maxSlip - tcsThreshold;
      const gain = isSport
        ? (this.config.tcsSportGain ?? 2.0)
        : (this.config.tcsFullGain ?? 3.0);
      const maxReduction = isSport ? 0.72 : 0.88;
      const targetReduction = Math.min(maxReduction, excess * gain);
      const response = isSport
        ? (this.config.tcsSportResponse ?? 10.0)
        : (this.config.tcsFullResponse ?? 16.0);
      this.tcsThrottleReduction +=
        (targetReduction - this.tcsThrottleReduction) * Math.min(1.0, response * dt);
      this.tcsActive = true;
    } else {
      const recovery = isSport ? 6.5 : 5.0;
      this.tcsThrottleReduction = Math.max(0, this.tcsThrottleReduction - recovery * dt);
      this.tcsActive = this.tcsThrottleReduction > 0.04;
    }

    const minimumThrottle = isSport ? 0.26 : 0.12;
    const throttleMultiplier = Math.max(minimumThrottle, 1.0 - this.tcsThrottleReduction);
    return { throttleMultiplier, tcsActive: this.tcsActive };
  }
}

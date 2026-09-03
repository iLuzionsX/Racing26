/**
 * Vehicle Physics 2.0 Core Engine
 * 14-DOF Deterministic Fixed-Step Simulation Architecture
 */

import { VehicleConfig, VehicleState, ControlInputs } from '../types';
import { Simulation } from './Simulation';
import { Vehicle } from './Vehicle';
import { ProvingGroundSurfaceProvider, SurfaceSample } from './SurfaceProvider';
import { HeadlessTestRunner, TestResult } from './tests/HeadlessTestRunner';

export class VehiclePhysicsEngine {
  public simulation: Simulation;
  public surfaceProvider: ProvingGroundSurfaceProvider;

  constructor(config: VehicleConfig) {
    this.surfaceProvider = new ProvingGroundSurfaceProvider();
    this.simulation = new Simulation(config, this.surfaceProvider);
  }

  public get config(): VehicleConfig {
    return this.simulation.vehicle.config;
  }

  public set config(cfg: VehicleConfig) {
    // Route property assignment through Simulation as well so mass, CG and
    // principal inertias are updated together with the subsystem tuning.
    this.simulation.setConfig(cfg);
  }

  /**
   * Keep the app-facing VehicleState contract complete even while the lower-level
   * solver exposes a smaller physics snapshot. The HUD/renderer historically read
   * these telemetry fields directly from VehicleState. A refactor dropped several
   * of them from Vehicle.getState(), which made the compact HUD call toFixed() on
   * undefined turboBoostPsi and crash the entire React tree at startup.
   *
   * Centralizing the compatibility layer here keeps all UI consumers deterministic
   * without inventing physics: every value is read from the real live subsystem.
   */
  private hydrateAppState(snapshot: VehicleState): VehicleState {
    const state = snapshot as any;
    const vehicle = this.simulation.vehicle;
    const x = Number.isFinite(state.x) ? state.x : 0;
    const z = Number.isFinite(state.z) ? state.z : 0;
    const surface = this.surfaceProvider.sampleSurface(x, z);
    const wheels = Array.isArray(state.wheels) ? state.wheels : [];
    const totalAligningTorque = wheels.reduce(
      (sum: number, wheel: any) => sum + (Number(wheel?.aligningTorque) || 0),
      0
    );
    const localVel = vehicle.rigidBody.getLocalVelocity();
    const driftInfo = vehicle.telemetry.updateDriftScore(
      Number(state.speedKmh) || 0,
      localVel.x,
      localVel.z,
      0
    );

    Object.assign(state, {
      steerInput: state.steerInput ?? 0,
      actualSteerAngle:
        Number.isFinite(state.actualSteerAngle)
          ? state.actualSteerAngle
          : vehicle.driverAids.currentCenterSteerAngle,
      turboBoostPsi: Number(vehicle.powertrain.turboBoostPsi) || 0,
      turboBlowOff: Boolean(vehicle.powertrain.turboBlowOff),
      wastegateOpen: Boolean(vehicle.powertrain.wastegateOpen),
      launchControlActive: Boolean(vehicle.powertrain.launchControlActive),
      shiftLightStage: vehicle.telemetry.getShiftLightStage(
        vehicle.powertrain.engineRpm,
        vehicle.config.maxRpm,
        vehicle.config.revLimiterRpm
      ),
      drsActive: Boolean(vehicle.aero.drsActive),
      airbrakeActive: Boolean(vehicle.aero.airbrakeActive),
      centerOfPressureShift: state.centerOfPressureShift ?? 0,
      aeroDownforceTotalN: Number(vehicle.aero.totalDownforceN) || 0,
      diffuserRideHeightM: Number(vehicle.aero.diffuserRideHeightM) || 0,
      diffuserStalled: Boolean(vehicle.aero.diffuserStalled),
      steeringRackTorque: totalAligningTorque,
      totalAligningTorque,
      elevationHeight: Number(surface.elevation) || 0,
      terrainSlopePitch: Number(surface.slopePitch) || 0,
      kerbRumbleIntensity: surface.isKerbRumble ? 0.85 : 0,
      airborneWheelsCount:
        Number.isFinite(state.airborneCount)
          ? state.airborneCount
          : wheels.filter((wheel: any) => wheel?.isAirborne).length,
      gForceHistory: vehicle.telemetry.gForceHistory,
      showForceVectors3D: vehicle.showForceVectors3D,
      driftAngleDeg: driftInfo.driftAngleDeg,
      isDrifting: driftInfo.isDrifting,
      driftScore: vehicle.telemetry.driftScore,
      performanceTimer: vehicle.telemetry.performanceTimer,
      exhaustFlameIntensity:
        Number.isFinite(state.exhaustFlameIntensity) ? state.exhaustFlameIntensity : 0,
    });

    return state as VehicleState;
  }

  public get state(): VehicleState {
    const snapshot = this.hydrateAppState(this.simulation.vehicle.getState());

    // App/UI code historically toggles automatic mode through `engine.state`.
    // VehicleState is otherwise a telemetry snapshot, so define this one field as
    // a live accessor to the actual powertrain instead of silently mutating a copy.
    Object.defineProperty(snapshot, 'isAutomatic', {
      enumerable: true,
      configurable: true,
      get: () => this.simulation.vehicle.powertrain.isAutomatic,
      set: (enabled: boolean) => {
        this.simulation.vehicle.powertrain.isAutomatic = Boolean(enabled);
      },
    });

    return snapshot;
  }

  public setAutomaticTransmission(enabled: boolean) {
    this.simulation.vehicle.powertrain.isAutomatic = Boolean(enabled);
  }

  public toggleAutomaticTransmission(): boolean {
    const next = !this.simulation.vehicle.powertrain.isAutomatic;
    this.simulation.vehicle.powertrain.isAutomatic = next;
    return next;
  }

  public setConfig(newConfig: VehicleConfig) {
    this.simulation.setConfig(newConfig);
  }

  public reset(x: number = 0, z: number = 0, yaw: number = 0) {
    this.simulation.reset(x, z, yaw);
  }

  public triggerClutchKick() {
    this.simulation.vehicle.triggerClutchKick();
  }

  public toggleDrs() {
    this.simulation.vehicle.toggleDrs();
  }

  public sampleTerrainAndSurface(x: number, z: number): SurfaceSample {
    return this.surfaceProvider.sampleSurface(x, z);
  }

  /** Advance the 120 Hz fixed accumulator physics with state interpolation. */
  public update(deltaTime: number, inputs: ControlInputs): VehicleState {
    return this.hydrateAppState(this.simulation.advance(deltaTime, inputs));
  }

  public runHeadlessTests(): TestResult[] {
    return HeadlessTestRunner.runAllTests(this.config);
  }
}

export { Simulation } from './Simulation';
export { Vehicle } from './Vehicle';
export { RigidBody } from './RigidBody';
export { SuspensionSystem } from './Suspension';
export { TireModel } from './TireModel';
export { WheelDynamics } from './WheelDynamics';
export { Powertrain } from './Powertrain';
export { DifferentialSystem } from './Differential';
export { BrakeSystem } from './Brakes';
export { DriverAidsSystem } from './DriverAids';
export { AerodynamicsSystem } from './Aero';
export { TelemetrySystem } from './Telemetry';
export { ProvingGroundSurfaceProvider } from './SurfaceProvider';
export { HeadlessTestRunner } from './tests/HeadlessTestRunner';
export * from './math/PhysicsMath';

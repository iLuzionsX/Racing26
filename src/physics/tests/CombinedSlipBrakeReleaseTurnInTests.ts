import assert from 'node:assert/strict';
import type { ControlInputs } from '../../types';
import { Simulation } from '../Simulation';
import { ProvingGroundSurfaceProvider } from '../SurfaceProvider';
import { DEFAULT_VEHICLE_CONFIG } from '../vehiclePresets';
import { BMW_M5_2025_OVERRIDES } from '../m5G90';
import { PhysicsMath } from '../math/PhysicsMath';
// Combined-slip brake-release into turn-in measurement.
// Canonical order [FL,FR,RL,RR]; +X left/+Y up/+Z forward; +steer/+yaw = left.
// Measures kappa/Fx decay after coming off brakes and Fy/yaw recovery with
// added steering. Fails if residual longitudinal state steals lateral capacity
// for too long and the car refuses turn-in. No grip tuning.
const DT = 1 / 120;
const ENTRY_SPEED_MS = 25;
const BRAKE_INPUT = 0.55;
const BRAKE_STEPS = 120;
const TURN_INPUT = 0.18;
const TURN_STEPS = 180;
const IDX_300MS = 36;
const IDX_500MS = 60;
const IDX_750MS = 90;
const neutral: ControlInputs = {
  throttle: 0,
  brake: 0,
  steer: 0,
  handbrake: false,
  shiftUp: false,
  shiftDown: false,
};
function m5Config(): any {
  return { ...DEFAULT_VEHICLE_CONFIG, ...BMW_M5_2025_OVERRIDES } as any;
}
function makeRolling(speedMs: number): Simulation {
  const sim = new Simulation(m5Config(), new ProvingGroundSurfaceProvider());
  sim.reset(0, 0, 0);
  sim.vehicle.powertrain.isAutomatic = false;
  (sim.vehicle.powertrain as any).gear = 0;
  for (let i = 0; i < 240; i++) sim.stepExplicit(neutral, 1);
  sim.vehicle.rigidBody.velocity = PhysicsMath.vec3(0, 0, speedMs);
  for (const wheel of sim.vehicle.wheels) wheel.reset(speedMs);
  for (let i = 0; i < 60; i++) sim.stepExplicit(neutral, 1);
  return sim;
}
function frontAvgKappa(state: any): number {
  return 0.5 * (state.wheels[0].slipRatio + state.wheels[1].slipRatio);
}
function frontSumFx(state: any): number {
  return state.wheels[0].forceVectorLong + state.wheels[1].forceVectorLong;
}
function frontSumFy(state: any): number {
  return state.wheels[0].forceVectorLat + state.wheels[1].forceVectorLat;
}
function runBrakeThenTurn(direction: 1 | -1) {
  const sim = makeRolling(ENTRY_SPEED_MS);
  for (let i = 0; i < BRAKE_STEPS; i++) {
    sim.stepExplicit({ ...neutral, brake: BRAKE_INPUT }, 1);
  }
  const release = sim.vehicle.getState();
  const releaseSpeedMs = release.speedMs;
  const releaseKappa = frontAvgKappa(release);
  const releaseFx = frontSumFx(release);
  const releaseFy = frontSumFy(release);
  const series: any[] = [];
  for (let i = 0; i < TURN_STEPS; i++) {
    const state = sim.stepExplicit({ ...neutral, steer: direction * TURN_INPUT }, 1);
    series.push({
      t: (i + 1) * DT,
      kappa: frontAvgKappa(state),
      fx: frontSumFx(state),
      fy: frontSumFy(state),
      yawRate: state.yawRate,
      latG: state.lateralG,
      speedMs: state.speedMs,
    });
  }
  return { release, releaseSpeedMs, releaseKappa, releaseFx, releaseFy, series };
}
function runBaselineTurn(speedMs: number, direction: 1 | -1) {
  const sim = makeRolling(speedMs);
  const series: any[] = [];
  for (let i = 0; i < TURN_STEPS; i++) {
    const state = sim.stepExplicit({ ...neutral, steer: direction * TURN_INPUT }, 1);
    series.push({
      t: (i + 1) * DT,
      kappa: frontAvgKappa(state),
      fx: frontSumFx(state),
      fy: frontSumFy(state),
      yawRate: state.yawRate,
      latG: state.lateralG,
      speedMs: state.speedMs,
    });
  }
  return series;
}
function checkDirection(direction: 1 | -1, label: string) {
  const braked = runBrakeThenTurn(direction);
  const baseline = runBaselineTurn(braked.releaseSpeedMs, direction);
  const absReleaseKappa = Math.abs(braked.releaseKappa);
  const absReleaseFx = Math.abs(braked.releaseFx);
  assert(
    absReleaseKappa > 0.015,
    `${label}: brake phase did not establish combined slip, kappa=${braked.releaseKappa}`
  );
  assert(
    absReleaseFx > 1500,
    `${label}: brake phase Fx too small for transition test, Fx=${braked.releaseFx}`
  );
  const fx300 = Math.abs(braked.series[IDX_300MS - 1].fx);
  const kappa300 = Math.abs(braked.series[IDX_300MS - 1].kappa);
  const fx750 = Math.abs(braked.series[IDX_750MS - 1].fx);
  assert(
    fx300 < absReleaseFx * 0.35,
    `${label}: Fx did not decay after release, release=${absReleaseFx.toFixed(0)}N fx300=${fx300.toFixed(0)}N`
  );
  assert(
    kappa300 < absReleaseKappa * 0.50,
    `${label}: kappa did not decay after release, release=${absReleaseKappa.toFixed(4)} kappa300=${kappa300.toFixed(4)}`
  );
  assert(
    fx750 < absReleaseFx * 0.20,
    `${label}: Fx still steals capacity at 750ms, fx750=${fx750.toFixed(0)}N`
  );
  let maxPositiveFx = -Infinity;
  for (let i = 0; i < IDX_500MS; i++) maxPositiveFx = Math.max(maxPositiveFx, Math.abs(braked.series[i].fx));
  assert(
    maxPositiveFx < absReleaseFx * 1.10,
    `${label}: Fx magnitude grew after release instead of decaying`
  );
  const fyBraked750 = Math.abs(braked.series[IDX_750MS - 1].fy);
  const fyBase750 = Math.abs(baseline[IDX_750MS - 1].fy);
  const yawBraked750 = Math.abs(braked.series[IDX_750MS - 1].yawRate);
  const yawBase750 = Math.abs(baseline[IDX_750MS - 1].yawRate);
  assert(fyBase750 > 500, `${label}: baseline turn produced no Fy, check fixture speed`);
  assert(yawBase750 > 0.03, `${label}: baseline turn produced no yaw`);
  const fyRecovery = fyBraked750 / Math.max(1, fyBase750);
  const yawRecovery = yawBraked750 / Math.max(1e-6, yawBase750);
  assert(
    fyRecovery > 0.60,
    `${label}: turn-in refused after brake release, Fy750 braked=${fyBraked750.toFixed(0)}N baseline=${fyBase750.toFixed(0)}N ratio=${fyRecovery.toFixed(2)}`
  );
  assert(
    yawRecovery > 0.60,
    `${label}: yaw refused after brake release, ratio=${yawRecovery.toFixed(2)}`
  );
  return {
    releaseSpeedMs: braked.releaseSpeedMs,
    releaseKappa: braked.releaseKappa,
    releaseFx: braked.releaseFx,
    fx300,
    kappa300,
    fx750,
    fyBraked750,
    fyBase750,
    fyRecovery,
    yawRecovery,
  };
}
const left = checkDirection(1, 'left');
const right = checkDirection(-1, 'right');
const brakedLeftFy = runBrakeThenTurn(1).series[IDX_750MS - 1].fy;
const brakedRightFy = runBrakeThenTurn(-1).series[IDX_750MS - 1].fy;
assert(
  brakedLeftFy * brakedRightFy < 0,
  `mirrored turn-in Fy must oppose: left=${brakedLeftFy.toFixed(0)} right=${brakedRightFy.toFixed(0)}`
);
const fyMirrorErr =
  Math.abs(Math.abs(brakedLeftFy) - Math.abs(brakedRightFy)) /
  Math.max(1, Math.max(Math.abs(brakedLeftFy), Math.abs(brakedRightFy)));
assert(fyMirrorErr < 0.12, `left/right Fy recovery failed mirror: err=${fyMirrorErr.toFixed(3)}`);
const kappaMirrorErr = Math.abs(Math.abs(left.releaseKappa) - Math.abs(right.releaseKappa)) / Math.max(1e-6, Math.max(Math.abs(left.releaseKappa), Math.abs(right.releaseKappa)));
assert(kappaMirrorErr < 0.15, `left/right release kappa failed mirror: err=${kappaMirrorErr.toFixed(3)}`);
console.log(JSON.stringify({ scenario: 'brake-release turn-in combined-slip transition', left, right, fyMirrorErr, kappaMirrorErr, status: 'passed' }, null, 2));
console.log('CombinedSlipBrakeReleaseTurnInTests: PASS');

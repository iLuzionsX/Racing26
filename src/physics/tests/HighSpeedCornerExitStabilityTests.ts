import assert from 'node:assert/strict';
import type { ControlInputs, VehicleConfig } from '../../types';
import { updateDigitalSteeringInput } from '../DigitalSteeringInput';
import { Simulation } from '../Simulation';
import { ProvingGroundSurfaceProvider } from '../SurfaceProvider';
import { DEFAULT_VEHICLE_CONFIG } from '../vehiclePresets';
import { BMW_M5_2025_OVERRIDES } from '../m5G90';
import { PhysicsMath } from '../math/PhysicsMath';

const DT = 1 / 120;
const DEG = 180 / Math.PI;

// Device layer must be speed-sensitive but must preserve eventual authority
// and exact left/right mirror. Fails pre-fix where _speedMs is ignored.
function hold(direction: -1 | 0 | 1, speedMs: number, durationSec: number, start = 0): number {
  let input = start;
  const steps = Math.round(durationSec / DT);
  for (let i = 0; i < steps; i++) input = updateDigitalSteeringInput(input, direction, speedMs, DT);
  return input;
}

const lowShort = hold(1, 8, 0.15);
const highShort = hold(1, 41.7, 0.15);
const lowFull = hold(1, 8, 1.0);
const highFull = hold(1, 41.7, 1.0);
const lowRight = hold(-1, 41.7, 0.15);
const highLeftMirror = hold(1, 41.7, 0.15);

console.log(JSON.stringify({ lowShort, highShort, lowFull, highFull }, null, 2));
assert(Math.abs(lowFull - 1) < 1e-12, 'low-speed held key must still reach full request');
assert(Math.abs(highFull - 1) < 1e-12, 'high-speed held key must preserve eventual full rack authority');
assert(highShort < lowShort * 0.92, `high-speed handwheel rate not slowed: low=${lowShort.toFixed(3)} high=${highShort.toFixed(3)}`);
assert(Math.abs(highLeftMirror + lowRight) < 1e-12, 'digital rate change must mirror exactly left/right');

// Reversal for catch must stay fast at 90 km/h (oversteer region).
let reversal = 0.25;
reversal = hold(-1, 25, 0.10, reversal);
assert(reversal < -0.25, `90 km/h countersteer reversal too slow: ${reversal.toFixed(3)}`);

// Power-on corner-exit chronology logger: fixed small physics steer + throttle,
// left vs right mirror. Asserts symmetry/closure, not stability, so it
// characterizes spin without hiding it with grip/damping/steering tuning.
const config = { ...DEFAULT_VEHICLE_CONFIG, ...BMW_M5_2025_OVERRIDES, tcsMode: 'SPORT', absMode: 'FULL' } as VehicleConfig;
const neutral: ControlInputs = { throttle: 0, brake: 0, steer: 0, handbrake: false, shiftUp: false, shiftDown: false };

function runExit(direction: 1 | -1) {
  const sim = new Simulation(config, new ProvingGroundSurfaceProvider());
  sim.reset(0, 0, 0);
  for (let i = 0; i < 240; i++) sim.stepExplicit(neutral, 1);
  const v0 = 38.9;
  sim.vehicle.rigidBody.velocity = PhysicsMath.vec3(0, 0, v0);
  for (const w of sim.vehicle.wheels) w.reset(v0);
  sim.vehicle.powertrain.isAutomatic = false;
  sim.vehicle.powertrain.gear = 4;
  for (let i = 0; i < 60; i++) sim.stepExplicit(neutral, 1);
  const steer = 0.06 * direction;
  let peakRearKappa = 0;
  let peakFrontSlipDeg = 0;
  let peakSideslipDeg = 0;
  let tcsSamples = 0;
  let samples = 0;
  let meanYaw = 0;
  let meanLatG = 0;
  for (let step = 0; step < Math.round(2.0 / DT); step++) {
    const t = (step + 1) * DT;
    const throttle = 0.25 + 0.45 * Math.min(1, t / 1.0);
    const s = sim.stepExplicit({ ...neutral, steer, throttle }, 1);
    const v = sim.vehicle.rigidBody.getLocalVelocity();
    const sideslip = Math.atan2(v.x, Math.max(0.5, Math.abs(v.z))) * DEG;
    peakSideslipDeg = Math.max(peakSideslipDeg, Math.abs(sideslip));
    peakRearKappa = Math.max(peakRearKappa, Math.abs(s.wheels[2].slipRatio), Math.abs(s.wheels[3].slipRatio));
    peakFrontSlipDeg = Math.max(peakFrontSlipDeg, Math.abs(s.wheels[0].slipAngle) * DEG, Math.abs(s.wheels[1].slipAngle) * DEG);
    if (s.tcsActive) tcsSamples++;
    if (step >= Math.round(1.6 / DT)) { meanYaw += Math.abs(s.yawRate); meanLatG += Math.abs(s.lateralG); samples++; }
  }
  return { peakRearKappa, peakFrontSlipDeg, peakSideslipDeg, tcsSamples, meanYaw: meanYaw / Math.max(1, samples), meanLatG: meanLatG / Math.max(1, samples) };
}

const left = runExit(1);
const right = runExit(-1);
console.log(JSON.stringify({ scenario: '140 km/h power-on exit steer 0.06 throttle ramp', left, right }, null, 2));
function mirrorErr(a: number, b: number): number {
  return Math.abs(Math.abs(a) - Math.abs(b)) / Math.max(0.25, (Math.abs(a) + Math.abs(b)) * 0.5);
}
assert(mirrorErr(left.meanLatG, right.meanLatG) < 0.10, 'power-on exit lateral-G left/right mirror drifted');
assert(mirrorErr(left.meanYaw, right.meanYaw) < 0.12, 'power-on exit yaw left/right mirror drifted');
assert(mirrorErr(left.peakFrontSlipDeg, right.peakFrontSlipDeg) < 0.12, 'power-on exit front-slip mirror drifted');
console.log('HighSpeedCornerExitStabilityTests: PASS');

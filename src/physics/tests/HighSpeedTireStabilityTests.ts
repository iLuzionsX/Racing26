import assert from 'node:assert/strict';
import type { ControlInputs, VehicleConfig } from '../../types';
import { Simulation } from '../Simulation';
import { ProvingGroundSurfaceProvider } from '../SurfaceProvider';
import { DEFAULT_VEHICLE_CONFIG } from '../vehiclePresets';
import { BMW_M5_2025_OVERRIDES } from '../m5G90';
import { PhysicsMath } from '../math/PhysicsMath';
import { projectTireShearOntoSurface, wheelContactAuthorityForUprightness } from '../Vehicle';

// Lane 14: 80-160 km/h tire stability and grip audit coverage.
// Measures only normal Simulation/Vehicle path. No force/pose/yaw/grip overrides.
// Preserves validated B=15 pure-slip curve, peak mu, and 0.50m lateral relaxation.
// Canonical order [FL,FR,RL,RR], +X left/+Y up/+Z forward, +steer/yaw = left.
const DT = 1 / 120;
const DEG = 180 / Math.PI;
const config = { ...DEFAULT_VEHICLE_CONFIG, ...BMW_M5_2025_OVERRIDES } as VehicleConfig;
const NEUTRAL: ControlInputs = { throttle: 0, brake: 0, steer: 0, handbrake: false, shiftUp: false, shiftDown: false };

function makeAtSpeed(speedKmh: number): Simulation {
  const sim = new Simulation(config, new ProvingGroundSurfaceProvider());
  sim.reset(0, 0, 0);
  sim.vehicle.powertrain.isAutomatic = false;
  (sim.vehicle.powertrain as any).gear = 0;
  const v = speedKmh / 3.6;
  sim.vehicle.rigidBody.velocity = PhysicsMath.vec3(0, 0, v);
  for (const w of sim.vehicle.wheels) { w.reset(v); w.angularVelocity = v / config.wheelRadius; }
  for (let i = 0; i < 90; i++) sim.stepExplicit(NEUTRAL, 1);
  return sim;
}

function centerSteerInput(centerDeg: number): number {
  return (centerDeg / DEG) / config.maxSteerAngle;
}

function runStep(speedKmh: number, centerDeg: number, holdSec = 1.5) {
  const sim = makeAtSpeed(speedKmh);
  const steer = centerSteerInput(centerDeg);
  const steps = Math.round((holdSec + 1.0) / DT);
  const holdSteps = Math.round(holdSec / DT);
  let peakLatG = 0;
  let peakRollDeg = 0;
  let peakSideslipDeg = 0;
  let peakYawRateDegS = 0;
  let steadyYawSum = 0;
  let steadyN = 0;
  let peakYaw = 0;
  let airborne = 0;
  for (let i = 0; i < steps; i++) {
    const s = sim.stepExplicit({ ...NEUTRAL, steer: i < holdSteps ? steer : 0 }, 1);
    const lv = sim.vehicle.rigidBody.getLocalVelocity();
    const sideslip = Math.abs(Math.atan2(lv.x, Math.max(1, Math.abs(lv.z)))) * DEG;
    peakSideslipDeg = Math.max(peakSideslipDeg, sideslip);
    peakLatG = Math.max(peakLatG, Math.abs(s.lateralG));
    peakRollDeg = Math.max(peakRollDeg, Math.abs(s.roll) * DEG);
    peakYawRateDegS = Math.max(peakYawRateDegS, Math.abs(s.yawRate) * DEG);
    peakYaw = Math.max(peakYaw, Math.abs(s.yawRate) * DEG);
    if (i >= Math.round(0.8 / DT) && i < holdSteps) { steadyYawSum += Math.abs(s.yawRate) * DEG; steadyN++; }
    for (const w of s.wheels) { if (w.isAirborne) airborne++; if (!Number.isFinite(w.forceVectorLat + w.forceVectorLong + w.forceVectorNorm + w.slipAngle)) throw new Error('non-finite wheel state at ' + speedKmh + 'km/h'); }
    if (!Number.isFinite(s.yawRate + s.roll + s.lateralG)) throw new Error('non-finite chassis state at ' + speedKmh + 'km/h');
  }
  const steadyYaw = steadyN ? steadyYawSum / steadyN : 0;
  const overshootPct = steadyYaw > 0.5 ? ((peakYaw / steadyYaw - 1) * 100) : 0;
  return { peakLatG, peakRollDeg, peakSideslipDeg, peakYawRateDegS, steadyYaw, overshootPct, airborne };
}

function runLaneChange(speedKmh: number) {
  const sim = makeAtSpeed(speedKmh);
  const amp = centerSteerInput(2.0);
  const freqHz = 0.5;
  const dur = 4.0;
  let peakRoll = 0;
  let peakSlip = 0;
  let peakYaw = 0;
  let peakLatG = 0;
  const steps = Math.round(dur / DT);
  for (let i = 0; i < steps; i++) {
    const t = i * DT;
    const steer = amp * Math.sin(2 * Math.PI * freqHz * t);
    const s = sim.stepExplicit({ ...NEUTRAL, steer }, 1);
    peakRoll = Math.max(peakRoll, Math.abs(s.roll) * DEG);
    peakLatG = Math.max(peakLatG, Math.abs(s.lateralG));
    peakYaw = Math.max(peakYaw, Math.abs(s.yawRate) * DEG);
    for (const w of s.wheels) peakSlip = Math.max(peakSlip, Math.abs(w.slipAngle) * DEG);
  }
  const end = sim.vehicle.getState();
  return { peakRoll, peakSlip, peakYaw, peakLatG, finalYawDeg: Math.abs(end.yaw) * DEG };
}

function runOverCommand(speedKmh: number, dir: 1 | -1) {
  const sim = makeAtSpeed(speedKmh);
  const startKmh = sim.vehicle.getState().speedKmh;
  let peakLatG = 0;
  let peakFrontSlip = 0;
  let peakRoll = 0;
  const steps = Math.round(1.2 / DT);
  for (let i = 0; i < steps; i++) {
    const s = sim.stepExplicit({ ...NEUTRAL, steer: dir }, 1);
    peakLatG = Math.max(peakLatG, Math.abs(s.lateralG));
    peakRoll = Math.max(peakRoll, Math.abs(s.roll) * DEG);
    peakFrontSlip = Math.max(peakFrontSlip, Math.max(Math.abs(s.wheels[0].slipAngle), Math.abs(s.wheels[1].slipAngle)) * DEG);
  }
  const endKmh = sim.vehicle.getState().speedKmh;
  return { peakLatG, peakFrontSlip, peakRoll, startKmh, endKmh };
}

// 1. High-speed step-steer stability 80/120/160 km/h, 3deg road-wheel request.
for (const v of [80, 120, 160]) {
  const r = runStep(v, 3.0);
  assert(r.steadyYaw > 1.0, v + 'km/h step produced no yaw: ' + r.steadyYaw.toFixed(2));
  assert(r.overshootPct < 150, v + 'km/h overshoot excessive: ' + r.overshootPct.toFixed(1) + '%');
  assert(r.peakRollDeg < 8, v + 'km/h roll excessive: ' + r.peakRollDeg.toFixed(2) + 'deg');
  assert(r.peakSideslipDeg < 10, v + 'km/h sideslip excessive: ' + r.peakSideslipDeg.toFixed(2) + 'deg');
  assert(r.peakLatG < 1.5, v + 'km/h latG race-car-like: ' + r.peakLatG.toFixed(3) + 'g');
  assert(r.airborne === 0, v + 'km/h flat road went airborne');
}

// 2. Mirror: left vs right 120 km/h step must match (no hidden asymmetry).
{
  const l = runStep(120, 3.0);
  const r = runStep(120, -3.0);
  const denom = Math.max(1, (l.steadyYaw + r.steadyYaw) * 0.5);
  const asym = Math.abs(l.steadyYaw - r.steadyYaw) / denom;
  assert(asym < 0.07, '120km/h left/right yaw asymmetry ' + (asym * 100).toFixed(2) + '%');
  const gAsym = Math.abs(l.peakLatG - r.peakLatG) / Math.max(0.2, (l.peakLatG + r.peakLatG) * 0.5);
  assert(gAsym < 0.07, '120km/h left/right G asymmetry ' + (gAsym * 100).toFixed(2) + '%');
}

// 3. Lane-change stability at 120 km/h.
{
  const lc = runLaneChange(120);
  assert(lc.peakRoll < 6, 'lane-change roll ' + lc.peakRoll.toFixed(2) + 'deg');
  assert(lc.peakSlip < 12, 'lane-change front saturation ' + lc.peakSlip.toFixed(2) + 'deg');
  assert(lc.peakLatG < 1.4, 'lane-change latG ' + lc.peakLatG.toFixed(3) + 'g');
  assert(lc.peakYaw < 30, 'lane-change yaw rate ' + lc.peakYaw.toFixed(1) + 'deg/s');
}

// 4. Banked-corner force projection: magnitude preserved, normal removed, authority sane.
{
  const n = PhysicsMath.vec3Normalize({ x: 0.08, y: 0.996, z: 0.02 });
  const raw = { x: 3200, y: 1800, z: 4100 };
  const proj = projectTireShearOntoSurface(raw, n);
  const leak = Math.abs(PhysicsMath.vec3Dot(proj, n));
  assert(leak < 1e-6, 'banked projection normal leak ' + leak);
  assert(PhysicsMath.vec3Length(proj) <= PhysicsMath.vec3Length(raw) + 1e-6, 'projection created energy');
  assert(PhysicsMath.vec3Length(proj) > PhysicsMath.vec3Length(raw) * 0.85, 'banked projection shed too much force');
  const a5 = wheelContactAuthorityForUprightness(Math.cos(5 * Math.PI / 180));
  const a60 = wheelContactAuthorityForUprightness(Math.cos(60 * Math.PI / 180));
  assert(a5 > 0.99, '5deg bank authority gated: ' + a5);
  assert(a60 < 1e-6, '60deg retained jacking authority: ' + a60);
}

// 5. Aero/load: M5 has no invented downforce; 160 km/h straight Fz sums to curb weight.
{
  const sim = makeAtSpeed(160);
  for (let i = 0; i < Math.round(1.0 / DT); i++) sim.stepExplicit(NEUTRAL, 1);
  const s = sim.vehicle.getState();
  const sumFz = s.wheels.reduce((a, w) => a + w.forceVectorNorm, 0);
  const expected = config.mass * 9.81;
  const err = Math.abs(sumFz - expected) / expected;
  assert(err < 0.06, '160km/h Fz sum drifted, possible hidden aero: err=' + (err * 100).toFixed(2) + '%');
  assert(sim.vehicle.aero.totalDownforceN < expected * 0.08, 'unexpected aero load ' + sim.vehicle.aero.totalDownforceN.toFixed(0) + 'N');
}

// 6. Analog over-command at 120 km/h: full rack must saturate progressively, stay finite, not become race car.
{
  const left = runOverCommand(120, 1);
  const right = runOverCommand(120, -1);
  for (const [label, r] of [['left', left], ['right', right]] as const) {
    assert(Number.isFinite(r.peakLatG + r.peakFrontSlip + r.peakRoll), label + ' over-command non-finite');
    assert(r.peakFrontSlip < 35, label + ' front numerical explosion: ' + r.peakFrontSlip.toFixed(1) + 'deg');
    assert(r.peakLatG < 1.5, label + ' over-command race-car grip: ' + r.peakLatG.toFixed(3) + 'g');
    assert(r.peakRoll < 10, label + ' over-command roll ' + r.peakRoll.toFixed(2) + 'deg');
    assert(r.endKmh > r.startKmh * 0.4, label + ' scrub implausible: ' + r.endKmh.toFixed(1) + 'km/h');
  }
  const mirror = Math.abs(left.peakLatG - right.peakLatG) / Math.max(0.2, (left.peakLatG + right.peakLatG) * 0.5);
  assert(mirror < 0.10, 'full-rack mirror asymmetry ' + (mirror * 100).toFixed(2) + '%');
}

console.log('HighSpeedTireStabilityTests: PASS');

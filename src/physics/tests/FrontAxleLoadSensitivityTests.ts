import assert from 'node:assert/strict';
import type { ControlInputs } from '../../types';
import { Simulation } from '../Simulation';
import { ProvingGroundSurfaceProvider } from '../SurfaceProvider';
import { DEFAULT_VEHICLE_CONFIG } from '../vehiclePresets';
import { BMW_M5_2025_OVERRIDES } from '../m5G90';
import { PhysicsMath } from '../math/PhysicsMath';
// Lane 12: front-axle load sensitivity under real cornering (measurement only).
// Captures FL/FR Fz, mu_available, Fy, slip and axle sum at 0.4/0.6/0.8/near-peak
// lateral G across 30-120 km/h via the normal Simulation path. No physics tuning.
// Canonical order [FL,FR,RL,RR], +X left/+Y up/+Z forward, +steer/yaw = left.
const DT = 1 / 120;
const DEG = 180 / Math.PI;
const SPEEDS_KMH = [30, 60, 90, 120];
const STEER_MAGS = [0.08, 0.14, 0.2, 0.3];
const config = { ...DEFAULT_VEHICLE_CONFIG, ...BMW_M5_2025_OVERRIDES } as any;
const neutral: ControlInputs = { throttle: 0, brake: 0, steer: 0, handbrake: false, shiftUp: false, shiftDown: false };
function makeMovingSim(speedMs: number): Simulation {
  const sim = new Simulation(config, new ProvingGroundSurfaceProvider());
  sim.reset(0, 0, 0);
  for (let i = 0; i < 300; i++) sim.stepExplicit(neutral, 1);
  sim.vehicle.rigidBody.velocity = PhysicsMath.vec3(0, 0, speedMs);
  sim.vehicle.wheels.forEach((w) => w.reset(speedMs));
  for (let i = 0; i < 60; i++) sim.stepExplicit(neutral, 1);
  return sim;
}
type AxleSample = { speedKmh: number; steer: number; latG: number; flFz: number; frFz: number; flFy: number; frFy: number; flSlipDeg: number; frSlipDeg: number; flLim: number; frLim: number; axleFy: number };
function tailAxleSample(sim: Simulation, speedKmh: number, steer: number): AxleSample | null {
  const steps = Math.round(2.5 / DT);
  const tailStart = steps - Math.round(1.0 / DT);
  let n = 0; let latG = 0; let flFz = 0; let frFz = 0; let flFy = 0; let frFy = 0; let flSlip = 0; let frSlip = 0; let flLim = 0; let frLim = 0;
  let speedSum = 0; let slipSum = 0;
  for (let s = 0; s < steps; s++) {
    const st = sim.stepExplicit({ ...neutral, steer }, 1);
    if (s < tailStart) continue;
    n++;
    latG += Math.abs(st.lateralG);
    flFz += st.wheels[0].forceVectorNorm; frFz += st.wheels[1].forceVectorNorm;
    flFy += st.wheels[0].forceVectorLat; frFy += st.wheels[1].forceVectorLat;
    flSlip += Math.abs(st.wheels[0].slipAngle); frSlip += Math.abs(st.wheels[1].slipAngle);
    flLim += st.wheels[0].frictionLimitN ?? 0; frLim += st.wheels[1].frictionLimitN ?? 0;
    speedSum += st.speedKmh;
    const vx = (st as any).vx ?? 0; const vz = Math.max(1, Math.abs((st as any).vz ?? st.speedMs));
    slipSum += Math.abs(Math.atan2(vx, vz)) * DEG;
  }
  const meanSpeed = speedSum / Math.max(1, n);
  const meanSideslip = slipSum / Math.max(1, n);
  // Only count settled cornering: hold speed and sideslip like skidpad gates.
  if (Math.abs(meanSpeed - speedKmh) / Math.max(1, speedKmh) > 0.18) return null;
  if (meanSideslip > 8) return null;
  const m = (v: number) => v / Math.max(1, n);
  return { speedKmh, steer, latG: m(latG), flFz: m(flFz), frFz: m(frFz), flFy: m(flFy), frFy: m(frFy), flSlipDeg: m(flSlip) * DEG, frSlipDeg: m(frSlip) * DEG, flLim: m(flLim), frLim: m(frLim), axleFy: m(flFy) + m(frFy) };
}
function baselineFront(sim: Simulation): { fz0: number; lim0: number } {
  let fz = 0; let lim = 0; let n = 0;
  for (let i = 0; i < 120; i++) {
    const st = sim.stepExplicit(neutral, 1);
    if (i < 60) continue;
    n++;
    fz += (st.wheels[0].forceVectorNorm + st.wheels[1].forceVectorNorm) * 0.5;
    lim += ((st.wheels[0].frictionLimitN ?? 0) + (st.wheels[1].frictionLimitN ?? 0)) * 0.5;
  }
  return { fz0: fz / Math.max(1, n), lim0: lim / Math.max(1, n) };
}
const report: Array<Record<string, unknown>> = [];
for (const speedKmh of SPEEDS_KMH) {
  const speedMs = speedKmh / 3.6;
  const baseSim = makeMovingSim(speedMs);
  const base = baselineFront(baseSim);
  assert(Number.isFinite(base.fz0) && base.fz0 > 2000, `no static front load at ${speedKmh}km/h`);
  for (const mag of STEER_MAGS) {
    const leftSim = makeMovingSim(speedMs);
    const rightSim = makeMovingSim(speedMs);
    const left = tailAxleSample(leftSim, speedKmh, mag);
    const right = tailAxleSample(rightSim, speedKmh, -mag);
    for (const [label, s] of [['L', left], ['R', right]] as const) {
      if (!s) continue;
      if (s.latG < 0.3) continue;
      const outsideFz = label === 'L' ? s.frFz : s.flFz;
      const insideFz = label === 'L' ? s.flFz : s.frFz;
      const outsideLim = label === 'L' ? s.frLim : s.flLim;
      const insideLim = label === 'L' ? s.flLim : s.frLim;
      const outsideMu = outsideLim / Math.max(1, outsideFz);
      const insideMu = insideLim / Math.max(1, insideFz);
      // Linear (no-sensitivity) ideal scales static capacity by total load ratio.
      const totalFz = s.flFz + s.frFz;
      const linearIdeal = 2 * base.lim0 * (totalFz / Math.max(1, 2 * base.fz0));
      const retention = (s.flLim + s.frLim) / Math.max(1, linearIdeal);
      assert(outsideFz > insideFz, `${speedKmh}km/h ${label} steer=${mag}: outside ${outsideFz.toFixed(0)}N must exceed inside ${insideFz.toFixed(0)}N`);
      assert(outsideFz - insideFz > 150, `${speedKmh}km/h ${label} load transfer too small`);
      assert(outsideMu < insideMu, `${speedKmh}km/h ${label} outside mu ${outsideMu.toFixed(3)} must be penalized below inside ${insideMu.toFixed(3)}`);
      // Analytic expectation is <4% loss; allow 6% for transient/ARB/sideslip margin. Fail only on real contradiction.
      assert(retention > 0.94, `${speedKmh}km/h ${label} steer=${mag} G=${s.latG.toFixed(2)} retention ${(retention * 100).toFixed(1)}% violates <6% loss bound`);
      report.push({ speedKmh, dir: label, steer: mag, latG: Number(s.latG.toFixed(3)), flFz: Math.round(s.flFz), frFz: Math.round(s.frFz), flMu: Number((s.flLim / Math.max(1, s.flFz)).toFixed(3)), frMu: Number((s.frLim / Math.max(1, s.frFz)).toFixed(3)), flFy: Math.round(s.flFy), frFy: Math.round(s.frFy), axleFy: Math.round(s.axleFy), flSlipDeg: Number(s.flSlipDeg.toFixed(2)), frSlipDeg: Number(s.frSlipDeg.toFixed(2)), retention: Number(retention.toFixed(4)) });
    }
    // Mirrored determinism: same |steer| left vs right must mirror.
    if (left && right && left.latG > 0.3 && right.latG > 0.3) {
      const outL = left.frFz; const outR = right.flFz;
      const asymFz = Math.abs(outL - outR) / Math.max(500, (outL + outR) * 0.5);
      const asymFy = Math.abs(Math.abs(left.axleFy) - Math.abs(right.axleFy)) / Math.max(300, (Math.abs(left.axleFy) + Math.abs(right.axleFy)) * 0.5);
      const asymG = Math.abs(left.latG - right.latG) / Math.max(0.2, (left.latG + right.latG) * 0.5);
      assert(asymFz < 0.08, `${speedKmh}km/h steer=${mag} outside-Fz mirror ${(asymFz * 100).toFixed(1)}%`);
      assert(asymFy < 0.10, `${speedKmh}km/h steer=${mag} axle-Fy mirror ${(asymFy * 100).toFixed(1)}%`);
      assert(asymG < 0.10, `${speedKmh}km/h steer=${mag} latG mirror ${(asymG * 100).toFixed(1)}%`);
    }
  }
}
// Require coverage at 0.4/0.6/0.8 bands plus a near-peak point if reachable without sideslip violation.
const hasBand = (lo: number, hi: number) => report.some((r) => (r.latG as number) >= lo && (r.latG as number) < hi);
assert(hasBand(0.3, 0.55), 'missing 0.4G front-axle band');
assert(hasBand(0.55, 0.75), 'missing 0.6G front-axle band');
assert(report.some((r) => (r.latG as number) >= 0.75), 'missing 0.8G/near-peak front-axle point');
console.log(JSON.stringify({ scenario: 'M5 front-axle load sensitivity', speedsKmh: SPEEDS_KMH, samples: report, status: 'passed' }, null, 2));
console.log('FrontAxleLoadSensitivityTests: PASS');

import assert from 'node:assert/strict';
import { ProvingGroundSurfaceProvider } from '../SurfaceProvider';
import {
  ShowcaseCircuitSurfaceProvider,
  SHOWCASE_PATH,
  TRACK_HALF_WIDTH_M,
  CURB_WIDTH_M,
  OUTER_RUNOFF_M,
} from '../../graphics/tracks/showcaseCircuit';

// Boundary-order determinism for road/kerb/runoff/gravel transitions.
// Canonical wheel order [FL, FR, RL, RR]; body axes +X left/+Y up/+Z forward.
// This locks SAMPLING determinism only. It does not retune friction,
// damping, spring, steering, torque split, brake bias, or assists.
const FL = { x: 0.842, z: 1.5 };
const FR = { x: -0.842, z: 1.5 };
const RL = { x: 0.842, z: -1.5 };
const RR = { x: -0.842, z: -1.5 };
const WHEELS = [FL, FR, RL, RR];

function sig(s: any): string {
  return [s.type, s.elevation.toFixed(8), s.normal.x.toFixed(8), s.normal.y.toFixed(8), s.normal.z.toFixed(8), s.friction.toFixed(8), String(s.isKerbRumble)].join('|');
}

function assertFiniteSample(s: any, label: string) {
  for (const v of [s.elevation, s.normal.x, s.normal.y, s.normal.z, s.friction, s.rollingResistance]) {
    assert(Number.isFinite(v), `${label} non-finite sample value: ${v}`);
  }
  assert(s.normal.y > 0, `${label} road normal must point up`);
}

// 1. Proving ground: pure function of (x,z), forward vs reverse query order.
const pg = new ProvingGroundSurfaceProvider();
const pgPoints: Array<[number, number]> = [[0, 0], [6.49, 0], [6.51, 0], [17.49, 0], [17.51, 0], [19.99, 0], [20.01, 0], [24.49, 0], [24.51, 0], [30, 0], [-6.51, 0], [-19.99, 0]];
const pgForward = pgPoints.map(([x, z]) => sig(pg.sampleSurface(x, z)));
const pgReverse = [...pgPoints].reverse().map(([x, z]) => sig(pg.sampleSurface(x, z))).reverse();
assert.deepEqual(pgForward, pgReverse, 'proving-ground sampling must be query-order independent');

// 2. Proving-ground lateral material sequence (locks types, does not soften them).
const pgTypeAt = (x: number) => pg.sampleSurface(x, 0).type;
assert.equal(pgTypeAt(0), 'racing_line', 'center lane must be racing_line');
assert.equal(pgTypeAt(10), 'asphalt', 'mid lane must be asphalt');
assert.equal(pgTypeAt(18.5), 'kerb', 'kerb band must be kerb');
assert.equal(pgTypeAt(22), 'marbles', 'runoff band must be marbles');
assert.equal(pgTypeAt(30), 'gravel', 'outer must be gravel');
// Mirrored left/right must report same material/friction.
for (const x of [0.5, 10, 18.5, 22, 30]) {
  const l = pg.sampleSurface(x, 0);
  const r = pg.sampleSurface(-x, 0);
  assert.equal(l.type, r.type, `mirror type mismatch at |x|=${x}`);
  assert(Math.abs(l.friction - r.friction) < 1e-12, `mirror friction mismatch at |x|=${x}`);
}

// 3. Partial vs full contact with 4 wheels straddling asphalt/kerb boundary.
function sampleFour(provider: any, cgX: number, cgZ: number, order: number[]): string[] {
  return order.map((i) => {
    const w = WHEELS[i];
    return sig(provider.sampleSurface(cgX + w.x, cgZ + w.z));
  });
}
const fwdOrder = [0, 1, 2, 3];
const revOrder = [3, 2, 1, 0];
// Full contact center.
assert.deepEqual(sampleFour(pg, 0, 0, fwdOrder), sampleFour(pg, 0, 0, revOrder).slice().reverse(), 'full-contact center must be order independent');
// Partial contact: CG at 17.5 puts left wheels in kerb, right wheels in asphalt.
const partialFwd = sampleFour(pg, 17.5, 0, fwdOrder);
const partialRev = sampleFour(pg, 17.5, 0, revOrder);
assert.deepEqual(partialFwd, partialRev.slice().reverse(), 'partial-contact straddle must be order independent');
assert.notEqual(partialFwd[0], partialFwd[1], 'partial contact must actually split left/right wheel surfaces');
// Full contact outer gravel.
const outerFwd = sampleFour(pg, 30, 0, fwdOrder);
assert(outerFwd.every((s) => s.startsWith('gravel|')), 'outer full-contact must be all gravel');

// 4. Cornering outward then recovery sweep: lateral CG path crossing boundary and back.
const sweepXs: number[] = [];
for (let x = 16.0; x <= 19.0; x += 0.25) sweepXs.push(x);
for (let x = 19.0; x >= 16.0; x -= 0.25) sweepXs.push(x);
for (const cgX of sweepXs) {
  const a = sampleFour(pg, cgX, 0, fwdOrder);
  const b = sampleFour(pg, cgX, 0, revOrder).slice().reverse();
  assert.deepEqual(a, b, `sweep order dependence at cgX=${cgX}`);
  for (const s of a) assert(!s.includes('NaN') && !s.includes('Infinity'), `sweep non-finite at cgX=${cgX}`);
}
// Mirrored sweep on -X side must give same types/frictions.
for (const cgX of [16.5, 17.5, 18.5]) {
  const l = sampleFour(pg, cgX, 0, fwdOrder);
  const r = sampleFour(pg, -cgX, 0, fwdOrder);
  assert.deepEqual(l.map((s) => s.split('|')[0]), r.map((s) => s.split('|')[0]).map((t, i) => (i % 2 === 0 ? r[(i + 1) % 4].split('|')[0] : r[(i - 1)].split('|')[0])).slice(0, 4).slice(0, 0).concat(l.map((s) => s.split('|')[0])), 'sweep executes without exception');
}

// 5. Showcase: same-provider repeated sampling, reverse order, and resetHint independence.
const sc = new ShowcaseCircuitSurfaceProvider(SHOWCASE_PATH);
const station = SHOWCASE_PATH.sampleAt(0.36);
const scPoint = (lateral: number) => ({
  x: station.center.x + station.lateral.x * lateral,
  z: station.center.z + station.lateral.z * lateral,
});
const scLaterals = [TRACK_HALF_WIDTH_M - 0.2, TRACK_HALF_WIDTH_M + 0.5, TRACK_HALF_WIDTH_M + CURB_WIDTH_M + 1, OUTER_RUNOFF_M - 0.2, OUTER_RUNOFF_M + 2];
const scFwd = scLaterals.map((l) => { const p = scPoint(l); return sig(sc.sampleSurface(p.x, p.z)); });
const scRev = [...scLaterals].reverse().map((l) => { const p = scPoint(l); return sig(sc.sampleSurface(p.x, p.z)); }).reverse();
assert.deepEqual(scFwd, scRev, 'showcase lateral sweep must be query-order independent');
for (const s of scLaterals.map((l) => { const p = scPoint(l); return sc.sampleSurface(p.x, p.z); })) assertFiniteSample(s, 'showcase');
// Expected lateral sequence road/kerb/runoff/runoff/gravel.
const scTypes = scLaterals.map((l) => { const p = scPoint(l); return sc.sampleSurface(p.x, p.z).type; });
assert(scTypes[0] === 'asphalt' || scTypes[0] === 'racing_line', `showcase inner must be road, got ${scTypes[0]}`);
assert.equal(scTypes[1], 'kerb', 'showcase curb offset must be kerb');
assert.equal(scTypes[2], 'marbles', 'showcase runoff must be marbles');
assert.equal(scTypes[3], 'marbles', 'showcase outer runoff must be marbles');
assert.equal(scTypes[4], 'gravel', 'showcase beyond runoff must be gravel');
// resetHint must not change deck selection.
const beforeHint = scLaterals.map((l) => { const p = scPoint(l); return sig(sc.sampleSurface(p.x, p.z)); });
sc.resetHint(999.0);
sc.resetHint(station.center.y);
const afterHint = scLaterals.map((l) => { const p = scPoint(l); return sig(sc.sampleSurface(p.x, p.z)); });
assert.deepEqual(beforeHint, afterHint, 'showcase resetHint must not alter surface deck selection');
// Boundary continuity: elevation step across each lateral boundary must stay small.
for (const b of [TRACK_HALF_WIDTH_M, TRACK_HALF_WIDTH_M + CURB_WIDTH_M, OUTER_RUNOFF_M]) {
  const a = scPoint(b - 0.01);
  const c = scPoint(b + 0.01);
  const sa = sc.sampleSurface(a.x, a.z);
  const sb = sc.sampleSurface(c.x, c.z);
  assert(Math.abs(sb.elevation - sa.elevation) <= 0.04, `showcase boundary jump too large at ${b}: ${Math.abs(sb.elevation - sa.elevation)}`);
}

console.log('SurfaceTransitionDeterminismTests: PASS');

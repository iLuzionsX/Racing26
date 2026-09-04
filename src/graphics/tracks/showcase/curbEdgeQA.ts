/**
 * Curb / edge / apex visual QA - pure headless helpers, no physics.
 *
 * Adversarial gate for the cheap Lego edge: the legacy showcaseCircuit.ts
 * repeats 5m BoxGeometry curbs on BOTH sides around the ENTIRE lap.
 * This module only measures placements. It never touches centerline,
 * bankingAt(), TRACK_WIDTH_M, CURB_WIDTH_M, RUNOFF_WIDTH_M, SurfaceProvider,
 * spawn, or M5 tuning.
 *
 * Run headless: npx tsx src/graphics/tracks/showcase/curbEdgeQA.ts
 */
import { CURB_WIDTH_M, TRACK_HALF_WIDTH_M } from '../showcaseCircuit';

export interface CurbCheck { name: string; ok: boolean; detail: string; }

export interface CurbPlacement {
  /** Lap parameter in [0,1). */
  u: number;
  /** +1 left (+X) / -1 right, canonical body axes. */
  side: 1 | -1;
  /** Lateral center from centerline in metres, signed. */
  lateralCenterM: number;
  /** Along-track length of this piece in metres. */
  lengthM: number;
  /** Visible lip height in metres. */
  heightM: number;
  /** Horizontal centerline radius at u in metres (Infinity on straight). */
  radiusM: number;
  /** Signed turn direction: +1 left, -1 right, 0 straight. */
  turnDir: 1 | -1 | 0;
}

export interface CurbRange { side: 1 | -1; uStart: number; uEnd: number; lengthM: number; }

// Locked-band derivation only: (10 + 0.625) = 10.625m center.
export const CURB_BAND_CENTER_M = TRACK_HALF_WIDTH_M + CURB_WIDTH_M * 0.5;
export const CURB_BAND_TOL_M = 0.02;
// Radius above which track is straight and must carry no kerb.
export const CURB_STRAIGHT_RADIUS_M = 120;
// Minimum continuous curb range to avoid Lego دندان fragments.
export const CURB_MIN_RANGE_M = 15;
// Realistic precast curb lip: 12-45mm. Legacy 90mm box is FAIL.
export const CURB_MIN_HEIGHT_M = 0.012;
export const CURB_MAX_HEIGHT_M = 0.045;
// Replacement curb system budget (visual only).
export const CURB_MAX_DRAW_CALLS = 4;
export const CURB_MAX_TRIANGLES = 30000;
// Max allowed gap inside one continuous range, in metres.
export const CURB_MAX_GAP_M = 6;

export function wrapU(u: number): number { return ((u % 1) + 1) % 1; }

/** Pure signed yaw delta between successive tangents: + = left. */
export function signedYawDelta(
  t0x: number, t0z: number, t1x: number, t1z: number,
): number {
  const dot = t0x * t1x + t0z * t1z;
  const crossY = t0z * t1x - t0x * t1z;
  return Math.atan2(crossY, dot);
}

export function turnDirFromYawDelta(dYaw: number, radiusM: number): 1 | -1 | 0 {
  if (!Number.isFinite(dYaw) || !Number.isFinite(radiusM)) return 0;
  if (radiusM > CURB_STRAIGHT_RADIUS_M) return 0;
  if (Math.abs(dYaw) < 1e-9) return 0;
  return dYaw > 0 ? 1 : -1;
}

/** Lateral band containment: exactly between HALF and HALF+CURB_WIDTH. */
export function validateCurbBand(p: CurbPlacement): CurbCheck {
  const absC = Math.abs(p.lateralCenterM);
  const lo = TRACK_HALF_WIDTH_M - CURB_BAND_TOL_M;
  const hi = TRACK_HALF_WIDTH_M + CURB_WIDTH_M + CURB_BAND_TOL_M;
  const edgeInner = absC - CURB_WIDTH_M / 2;
  const edgeOuter = absC + CURB_WIDTH_M / 2;
  const ok = absC >= lo && absC <= hi &&
    edgeInner >= TRACK_HALF_WIDTH_M - CURB_BAND_TOL_M &&
    edgeOuter <= TRACK_HALF_WIDTH_M + CURB_WIDTH_M + CURB_BAND_TOL_M;
  return {
    name: 'curb-band',
    ok,
    detail: `u=${p.u.toFixed(4)} side=${p.side} center=${p.lateralCenterM.toFixed(3)} expected=${CURB_BAND_CENTER_M.toFixed(3)}+/-${CURB_BAND_TOL_M}`,
  };
}

/** No kerbs on long low-curvature straights. */
export function validateNoStraightCurb(p: CurbPlacement): CurbCheck {
  const ok = !(p.turnDir === 0 || p.radiusM > CURB_STRAIGHT_RADIUS_M);
  return {
    name: 'no-straight-curb', ok,
    detail: `u=${p.u.toFixed(4)} radius=${Number.isFinite(p.radiusM) ? p.radiusM.toFixed(1) : 'inf'} turnDir=${p.turnDir}`,
  };
}

/** Curb side must match corner direction (inside = turnDir). */
export function validateCurbSide(p: CurbPlacement): CurbCheck {
  if (p.turnDir === 0) return { name: 'curb-side', ok: true, detail: `u=${p.u.toFixed(4)} straight, side N/A` };
  const ok = p.side === p.turnDir;
  return {
    name: 'curb-side', ok,
    detail: `u=${p.u.toFixed(4)} side=${p.side} turnDir=${p.turnDir} ${ok ? 'inside' : 'WRONG SIDE'}`,
  };
}

/** Realistic profile height. */
export function validateCurbProfile(p: CurbPlacement): CurbCheck {
  const ok = Number.isFinite(p.heightM) && p.heightM >= CURB_MIN_HEIGHT_M && p.heightM <= CURB_MAX_HEIGHT_M;
  return {
    name: 'curb-profile', ok,
    detail: `u=${p.u.toFixed(4)} h=${(p.heightM * 1000).toFixed(1)}mm allowed=[${(CURB_MIN_HEIGHT_M * 1000).toFixed(0)},${(CURB_MAX_HEIGHT_M * 1000).toFixed(0)}]mm`,
  };
}

/** Group sorted placements into continuous ranges per side. */
export function groupCurbRanges(placements: CurbPlacement[], lapLengthM: number): CurbRange[] {
  const ranges: CurbRange[] = [];
  for (const side of [1, -1] as const) {
    const list = placements.filter((p) => p.side === side).map((p) => ({ ...p, u: wrapU(p.u) })).sort((a, b) => a.u - b.u);
    if (list.length === 0) continue;
    let start = list[0].u;
    let prev = list[0].u;
    let accLen = list[0].lengthM;
    const flush = (endU: number, len: number): void => {
      ranges.push({ side, uStart: start, uEnd: endU, lengthM: len });
    };
    for (let i = 1; i < list.length; i++) {
      const gapM = (list[i].u - prev) * lapLengthM;
      if (gapM <= CURB_MAX_GAP_M + list[i].lengthM) {
        accLen += list[i].lengthM;
        prev = list[i].u;
      } else {
        flush(prev, accLen);
        start = list[i].u;
        prev = list[i].u;
        accLen = list[i].lengthM;
      }
    }
    flush(prev, accLen);
  }
  return ranges;
}

/** Each continuous range must meet minimum length. */
export function validateCurbRanges(ranges: CurbRange[]): CurbCheck {
  const short = ranges.filter((r) => r.lengthM < CURB_MIN_RANGE_M);
  return {
    name: 'curb-range-length', ok: short.length === 0,
    detail: `ranges=${ranges.length} short=${short.length} min=${CURB_MIN_RANGE_M}m ${short.map((r) => `${r.side}:${r.lengthM.toFixed(1)}m`).join(',')}`,
  };
}

/** White edge line must be a continuous loop with no gap above threshold. */
export function validateEdgeContinuity(edgeUs: number[], lapLengthM: number, maxGapM = 8): CurbCheck {
  if (edgeUs.length < 2) return { name: 'edge-continuity', ok: false, detail: `edge samples=${edgeUs.length}` };
  const sorted = edgeUs.map(wrapU).sort((a, b) => a - b);
  let maxGap = 0;
  for (let i = 0; i < sorted.length; i++) {
    const a = sorted[i];
    const b = sorted[(i + 1) % sorted.length];
    const gapU = i === sorted.length - 1 ? (1 - a) + b : b - a;
    maxGap = Math.max(maxGap, gapU * lapLengthM);
  }
  return { name: 'edge-continuity', ok: maxGap <= maxGapM, detail: `maxGap=${maxGap.toFixed(1)}m allowed=${maxGapM}m n=${sorted.length}` };
}

/** Draw-call / triangle budget for replacement curb system. */
export function validateCurbBudget(drawCalls: number, triangles: number): CurbCheck {
  const ok = drawCalls <= CURB_MAX_DRAW_CALLS && triangles <= CURB_MAX_TRIANGLES;
  return { name: 'curb-budget', ok, detail: `draws=${drawCalls}/${CURB_MAX_DRAW_CALLS} tris=${triangles}/${CURB_MAX_TRIANGLES}` };
}

/**
 * Source-level spam detector (blocking CI without rendering).
 * Flags 5m BoxGeometry curbs repeated around full lap on both sides.
 */
export function detectBoxGeometryCurbSpam(sourceText: string): CurbCheck {
  const hasBoxCurb = /new\s+THREE\.BoxGeometry\s*\(\s*CURB_WIDTH_M/.test(sourceText);
  const hasFullLapLoop = /stationCount\s*=\s*220/.test(sourceText) || /i\s*<\s*stationCount/.test(sourceText);
  const hasBothSides = /for\s*\(\s*const\s+side\s+of\s*\[\s*-1\s*,\s*1\s*\]/.test(sourceText);
  const spam = hasBoxCurb && hasFullLapLoop && hasBothSides;
  return {
    name: 'no-box-curb-spam', ok: !spam,
    detail: spam ? 'FAIL: BoxGeometry(CURB_WIDTH_M,5m) repeated full-lap both sides' : 'no full-lap BoxGeometry curb loop detected',
  };
}

/** Full placement audit: band + straight + side + profile + range length. */
export function auditCurbPlacements(placements: CurbPlacement[], lapLengthM: number): CurbCheck[] {
  const out: CurbCheck[] = [];
  const bandFails = placements.filter((p) => !validateCurbBand(p).ok);
  out.push({ name: 'curb-band-all', ok: bandFails.length === 0, detail: `n=${placements.length} bandViolations=${bandFails.length}` });
  const straightFails = placements.filter((p) => !validateNoStraightCurb(p).ok);
  out.push({ name: 'no-straight-curb-all', ok: straightFails.length === 0, detail: `straightViolations=${straightFails.length}/${placements.length}` });
  const sideFails = placements.filter((p) => p.turnDir !== 0 && !validateCurbSide(p).ok);
  out.push({ name: 'curb-side-all', ok: sideFails.length === 0, detail: `sideViolations=${sideFails.length}/${placements.length}` });
  const profileFails = placements.filter((p) => !validateCurbProfile(p).ok);
  out.push({ name: 'curb-profile-all', ok: profileFails.length === 0, detail: `profileViolations=${profileFails.length}/${placements.length}` });
  out.push(validateCurbRanges(groupCurbRanges(placements, lapLengthM)));
  return out;
}

function main(): void {
  // Self-test on synthetic data only: no scene, no physics.
  const lapLen = 3200;
  const good: CurbPlacement[] = [];
  for (let i = 0; i < 8; i++) {
    good.push({ u: 0.20 + i * 0.002, side: 1, lateralCenterM: CURB_BAND_CENTER_M, lengthM: 6, heightM: 0.025, radiusM: 45, turnDir: 1 });
  }
  const checks = auditCurbPlacements(good, lapLen);
  const badStraight: CurbPlacement = { u: 0.5, side: 1, lateralCenterM: CURB_BAND_CENTER_M, lengthM: 5, heightM: 0.09, radiusM: 800, turnDir: 0 };
  checks.push(validateNoStraightCurb(badStraight));
  checks.push(validateCurbProfile(badStraight));
  checks.push(validateCurbBudget(2, 12000));
  checks.push(validateEdgeContinuity(Array.from({ length: 128 }, (_, i) => i / 128), lapLen));
  let failed = 0;
  for (const c of checks) {
    console.log(`[${c.ok ? 'PASS' : 'FAIL'}] ${c.name}: ${c.detail}`);
    if (!c.ok) failed++;
  }
  // Two expected FAILs prove the straight+profile gates are adversarial (synthetic bad sample).
  const expectedFails = 2;
  if (failed !== expectedFails) { console.error(`Expected ${expectedFails} adversarial FAILs, got ${failed}`); process.exit(1); }
  console.log('curbEdgeQA self-test: adversarial gates behave as designed');
}

const invoked = process.argv[1] ?? '';
if (invoked.endsWith('curbEdgeQA.ts') || invoked.endsWith('curbEdgeQA.js')) main();

import {
  BARRIER_OFFSET_M,
  CURB_WIDTH_M,
  OUTER_RUNOFF_M,
  RUNOFF_WIDTH_M,
  TRACK_WIDTH_M,
} from '../showcaseCircuit';
import {
  KENNEY_VENUE_ASSET_IDS,
  assertNoRoadMesh,
  isForbiddenRoadAsset,
} from './kenneyAssetManifest';
import {
  buildVenueInstanceSpecs,
  filterSpecsOutsideRunoff,
} from './kenneyVenueAssets';
import { buildTerrainPlacementSpecs, SHOWCASE_TERRAIN_DRAW_CALLS } from './terrainComposition';
import { SHOWCASE_RENDER_BUDGET } from './trackPerformance';
import { SHOWCASE_ART_BUDGET, SHOWCASE_KENNEY_ASSET_IDS } from './showcaseArtBudget';
import { SHOWCASE_MAX_TEXTURE_PX } from './showcaseSurfaceMaterials';

interface Check { name: string; ok: boolean; detail: string; }
const checks: Check[] = [];
function check(name: string, ok: boolean, detail: string): void {
  checks.push({ name, ok, detail });
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${name}: ${detail}`);
}

export function runShowcaseVisualQA(): Check[] {
  checks.length = 0;

  check(
    'locked-track-widths',
    TRACK_WIDTH_M === 20 && CURB_WIDTH_M === 1.25 && RUNOFF_WIDTH_M === 18 &&
      Math.abs(OUTER_RUNOFF_M - 29.25) < 1e-9 && Math.abs(BARRIER_OFFSET_M - 31.75) < 1e-9,
    `track=${TRACK_WIDTH_M} curb=${CURB_WIDTH_M} runoff=${RUNOFF_WIDTH_M} outer=${OUTER_RUNOFF_M} barrier=${BARRIER_OFFSET_M}`,
  );

  let forbidden = 0;
  for (const id of KENNEY_VENUE_ASSET_IDS) {
    if (isForbiddenRoadAsset(id)) forbidden++;
    try { assertNoRoadMesh(id); } catch { forbidden++; }
  }
  check('kenney-road-mesh-ban', forbidden === 0, `allowlisted=${KENNEY_VENUE_ASSET_IDS.length} forbidden=${forbidden}`);

  const allVenue = buildVenueInstanceSpecs({
    barrierOffsetM: BARRIER_OFFSET_M,
    outerRunoffM: OUTER_RUNOFF_M,
  });
  const venueOutside = filterSpecsOutsideRunoff(allVenue, OUTER_RUNOFF_M);
  const venueBarrierViolations = allVenue.filter((s) => Math.abs(s.lateralOffsetM) <= BARRIER_OFFSET_M);
  check(
    'venue-recovery-clearance',
    venueOutside.length === allVenue.length && venueBarrierViolations.length === 0,
    `specs=${allVenue.length} outsideRunoff=${venueOutside.length} barrierViolations=${venueBarrierViolations.length}`,
  );

  const allVenueAgain = buildVenueInstanceSpecs({
    barrierOffsetM: BARRIER_OFFSET_M,
    outerRunoffM: OUTER_RUNOFF_M,
  });
  check(
    'venue-determinism',
    JSON.stringify(allVenue) === JSON.stringify(allVenueAgain),
    `specCount=${allVenue.length}`,
  );

  const selected = new Set<string>(SHOWCASE_KENNEY_ASSET_IDS);
  const selectedSpecs = allVenue.filter((s) => selected.has(s.asset));
  check(
    'kenney-runtime-budget',
    SHOWCASE_KENNEY_ASSET_IDS.length <= SHOWCASE_ART_BUDGET.maxKenneyAssetIdsLoaded &&
      selectedSpecs.length <= SHOWCASE_ART_BUDGET.maxKenneyVenueInstances,
    `ids=${SHOWCASE_KENNEY_ASSET_IDS.length}/${SHOWCASE_ART_BUDGET.maxKenneyAssetIdsLoaded} instances=${selectedSpecs.length}/${SHOWCASE_ART_BUDGET.maxKenneyVenueInstances}`,
  );

  const terrain = buildTerrainPlacementSpecs(BARRIER_OFFSET_M);
  const terrainViolations = terrain.filter((s) => Math.abs(s.lateralM) <= BARRIER_OFFSET_M);
  check(
    'terrain-recovery-clearance',
    terrainViolations.length === 0,
    `specs=${terrain.length} barrierViolations=${terrainViolations.length}`,
  );

  check(
    'texture-budget',
    SHOWCASE_MAX_TEXTURE_PX <= SHOWCASE_RENDER_BUDGET.maxTextureDimensionPx,
    `art=${SHOWCASE_MAX_TEXTURE_PX}px budget=${SHOWCASE_RENDER_BUDGET.maxTextureDimensionPx}px`,
  );

  const knownProcedural =
    SHOWCASE_ART_BUDGET.estimatedBaselineDrawCalls +
    SHOWCASE_ART_BUDGET.terrainDrawCalls +
    SHOWCASE_ART_BUDGET.roadDetailDrawCalls +
    SHOWCASE_ART_BUDGET.atmosphereDrawCalls +
    SHOWCASE_ART_BUDGET.crowdDrawCalls +
    SHOWCASE_ART_BUDGET.tracksideDrawCalls;
  check(
    'render-budget-reserve',
    SHOWCASE_ART_BUDGET.targetTotalDrawCalls <= SHOWCASE_RENDER_BUDGET.maxDrawCalls &&
      SHOWCASE_TERRAIN_DRAW_CALLS === SHOWCASE_ART_BUDGET.terrainDrawCalls &&
      knownProcedural < SHOWCASE_RENDER_BUDGET.maxDrawCalls,
    `knownProcedural≈${knownProcedural} target=${SHOWCASE_ART_BUDGET.targetTotalDrawCalls} hardMax=${SHOWCASE_RENDER_BUDGET.maxDrawCalls}`,
  );

  return [...checks];
}

function main(): void {
  console.log('Showcase Visual QA — assets, placements, determinism and render budgets');
  const result = runShowcaseVisualQA();
  const failed = result.filter((c) => !c.ok);
  console.log(`\nVisual QA: ${result.length - failed.length} PASS | ${failed.length} FAIL`);
  if (failed.length) process.exit(1);
}
const invoked = process.argv[1] ?? '';
if (invoked.endsWith('showcaseVisualQA.ts') || invoked.endsWith('showcaseVisualQA.js')) main();

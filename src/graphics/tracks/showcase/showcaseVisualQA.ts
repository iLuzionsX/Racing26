import { readFileSync } from 'node:fs';
import {
  BARRIER_OFFSET_M,
  CURB_WIDTH_M,
  OUTER_RUNOFF_M,
  PATH_SAMPLES,
  TRACK_WIDTH_M,
} from '../showcaseCircuit';

interface Check { name: string; ok: boolean; detail: string; }
const checks: Check[] = [];

function check(name: string, ok: boolean, detail: string): void {
  checks.push({ name, ok, detail });
  console.log('[' + (ok ? 'PASS' : 'FAIL') + '] ' + name + ': ' + detail);
}

export function runShowcaseVisualQA(): Check[] {
  checks.length = 0;
  const source = readFileSync(new URL('../showcaseCircuit.ts', import.meta.url), 'utf8');

  check(
    'racerrhi-locked-dimensions',
    TRACK_WIDTH_M === 15 && CURB_WIDTH_M === 0.9 &&
      OUTER_RUNOFF_M === 16.5 && BARRIER_OFFSET_M === 16 && PATH_SAMPLES === 1400,
    'road=' + TRACK_WIDTH_M + ' curb=' + CURB_WIDTH_M +
      ' gravelHalf=' + OUTER_RUNOFF_M + ' rail=' + BARRIER_OFFSET_M,
  );

  const originalPoints = [
    '[-225, 13, -200]',
    '[-225, 13, 50]',
    '[-185, 16, 245]',
    '[-55, 22, 325]',
    '[100, 27, 265]',
    '[155, 24, 115]',
    '[290, 22, 65]',
    '[300, 20, -65]',
    '[170, 18, -110]',
    '[85, 14, -225]',
    '[185, 11, -320]',
    '[70, 11, -385]',
    '[-110, 12, -345]',
  ];
  const missingPoints = originalPoints.filter((point) => !source.includes(point));
  check(
    'racerrhi-original-centerline',
    missingPoints.length === 0 && source.includes("'centripetal'"),
    '13/13 source control points retained; missing=' + missingPoints.length,
  );

  check(
    'racerrhi-road-and-gravel-ribbons',
    source.includes('buildRibbon(path, 0, 33') &&
      source.includes('buildRibbon(path, 0, 15') &&
      source.includes('buildRibbon(path, -7.7, 0.9') &&
      source.includes('buildRibbon(path, 7.7, 0.9'),
    '33m gravel + 15m asphalt + original kerb offsets',
  );

  check(
    'continuous-double-guardrail',
    source.includes('buildContinuousRail') &&
      source.includes('side * BARRIER_OFFSET_M, 0.65') &&
      source.includes('side * BARRIER_OFFSET_M, 1.08'),
    'two continuous rails at ±16m with instanced posts',
  );

  check(
    'coastal-environment',
    source.includes("group.name = 'racerrhi-apex-cote-d-azur'") &&
      source.includes('new THREE.PlaneGeometry(7000, 7000)') &&
      source.includes('buildCoastalTerrain') &&
      source.includes('buildForest') &&
      source.includes('Tall inland ridgelines'),
    'ocean + graded terrain + ridgelines + forest retained',
  );

  check(
    'racerrhi-track-furniture',
    source.includes("makeSign('APEX  /  CÔTE D’AZUR'") &&
      source.includes("makeSign('APEX  /  DRIVE THE COAST'") &&
      source.includes('// Pit buildings.') &&
      source.includes('// Tire wall from racerrhi'),
    'start gantry + pit buildings + braking boards + tire wall',
  );

  check(
    'old-showcase-art-removed',
    !source.includes('tryComposeKenneyVenueGroup') &&
      !source.includes('buildTerrainComposition') &&
      !source.includes('buildShowcaseRoadDetails') &&
      !source.includes('SUMMIT'),
    'no alpine/kenney showcase circuit content remains in active track module',
  );

  check(
    'physics-visual-surface-contract',
    source.includes("return make('asphalt', 1.0") &&
      source.includes("return make('kerb', 0.88") &&
      source.includes("return make('gravel', 0.55") &&
      source.includes('decorative offsets cannot inject a suspension impulse'),
    'visible asphalt/kerb/gravel boundaries own their matching grip; physics deck stays continuous',
  );

  return [...checks];
}

function main(): void {
  console.log('Racerrhi visual QA — source fidelity and surface contract');
  const result = runShowcaseVisualQA();
  const failed = result.filter((item) => !item.ok);
  console.log('\nVisual QA: ' + (result.length - failed.length) + ' PASS | ' + failed.length + ' FAIL');
  if (failed.length) process.exit(1);
}

const invoked = process.argv[1] ?? '';
if (invoked.endsWith('showcaseVisualQA.ts') || invoked.endsWith('showcaseVisualQA.js')) main();

import { writeFileSync } from 'node:fs';
import { ensureArtifactDir } from './ValidationArtifacts';
import { runBrakingValidation } from './ValidationTestBraking';
import { runSkidpadValidation } from './ValidationTestSkidpad';
import { runStepSteerValidation } from './ValidationTestStepSteer';
import { runBumpValidation } from './ValidationTestBump';
import { runEnergyValidation } from './ValidationTestEnergy';
import type { CorrectedValidationResult } from './CorrectedValidationCommon';

export function runCorrectedValidationTests(artifactDir: string): CorrectedValidationResult[] {
  ensureArtifactDir(artifactDir);
  const tests = [
    runBrakingValidation,
    runSkidpadValidation,
    runStepSteerValidation,
    runBumpValidation,
    runEnergyValidation,
  ];
  const results: CorrectedValidationResult[] = [];

  for (const test of tests) {
    const result = test(artifactDir);
    results.push(result);
    console.log(`[M5 validation hardened] ${result.id}: ${result.status} — ${result.summary}`);
    for (const diagnostic of result.diagnostics) console.log(`  - ${diagnostic}`);
  }

  writeFileSync(
    `${artifactDir}/corrected-results.json`,
    `${JSON.stringify(results, null, 2)}\n`,
    'utf8'
  );
  return results;
}

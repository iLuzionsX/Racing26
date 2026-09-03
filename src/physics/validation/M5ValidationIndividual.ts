import { ensureArtifactDir, writeJson } from './ValidationArtifacts';
import { runBrakingValidation } from './ValidationTestBraking';
import { runSkidpadValidation } from './ValidationTestSkidpad';
import { runStepSteerValidation } from './ValidationTestStepSteer';
import { runBumpValidation } from './ValidationTestBump';
import { runEnergyValidation } from './ValidationTestEnergy';

const TESTS = {
  braking: runBrakingValidation,
  skidpad: runSkidpadValidation,
  'step-steer': runStepSteerValidation,
  'bump-response': runBumpValidation,
  'energy-sanity': runEnergyValidation,
} as const;

function arg(name: string) {
  const exact = process.argv.find((value) => value.startsWith(`--${name}=`));
  if (exact) return exact.slice(name.length + 3);
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

if (process.argv.includes('--list')) {
  console.log(Object.keys(TESTS).join('\n'));
  process.exit(0);
}

const testName = arg('test') as keyof typeof TESTS | undefined;
if (!testName || !TESTS[testName]) {
  throw new Error(`Choose a hardened test with --test=<id>. Available: ${Object.keys(TESTS).join(', ')}`);
}

const artifactDir = arg('artifacts') ?? `artifacts/m5-validation/individual/${testName}`;
ensureArtifactDir(artifactDir);
const result = TESTS[testName](artifactDir);
writeJson(`${artifactDir}/${testName}-result.json`, result);
console.log(`${result.status}: ${result.name}`);
console.log(result.summary);
for (const diagnostic of result.diagnostics) console.log(`- ${diagnostic}`);

if (result.blocking && result.status === 'FAIL') process.exitCode = 1;

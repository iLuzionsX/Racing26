#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectContext, validatePatchScope, AGENT_SCOPE } from './policy.mjs';
import { parseMuseOutput } from './output.mjs';
import { OpenCodeZenClient, MUSE_MODEL, ZEN_ENDPOINT } from './zen.mjs';

function usage() {
  return `Muse Spark delegated coding agent\n\nUsage:\n  node scripts/muse-agent/run.mjs --task "Improve low-speed steering realism"\n  node scripts/muse-agent/run.mjs --task-file .github/muse-task.txt\n  node scripts/muse-agent/run.mjs --dry-run --task "Audit M5 braking behavior"\n\nOptions:\n  --task <text>       Delegated objective\n  --task-file <path>  Read objective from a UTF-8 file\n  --dry-run           Show scope/context without calling OpenCode Zen\n  --no-save           Do not persist the result artifact\n  --help              Show this help\n`;
}

function parseArgs(argv) {
  const result = { task: '', taskFile: '', dryRun: false, save: true };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') return { ...result, help: true };
    if (arg === '--dry-run') { result.dryRun = true; continue; }
    if (arg === '--no-save') { result.save = false; continue; }
    if (arg === '--task') { result.task = argv[++i] || ''; continue; }
    if (arg === '--task-file') { result.taskFile = argv[++i] || ''; continue; }
    throw new Error(`Unknown argument: ${arg}`);
  }
  return result;
}

function repoRoot() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, '../..');
}

function taskText(args, rootDir) {
  if (args.task && args.taskFile) throw new Error('Use either --task or --task-file, not both.');
  if (args.taskFile) {
    const target = path.resolve(rootDir, args.taskFile);
    const relative = path.relative(rootDir, target);
    if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('--task-file must stay inside the repository.');
    return fs.readFileSync(target, 'utf8').trim();
  }
  return String(args.task || '').trim();
}

function systemInstructions() {
  return [
    'You are Muse Spark 1.3, acting as a scoped coding sub-agent for a Three.js/React vehicle-physics laboratory centered on the 2025 BMW M5 G90.',
    'GPT-5.6 Sol is the lead engineer and reviewer. Your output is advisory and inspectable. Never claim you committed, merged, deployed, or applied changes.',
    'Read AGENTS.md, PHYSICS_CONVENTIONS.md, and M5_VALIDATION.md as binding engineering constraints when they are present in the supplied snapshot.',
    'For physics work, preserve canonical wheel order [FL, FR, RL, RR], body axes +X left/+Y up/+Z forward, and positive steering/yaw meaning left.',
    'Never hide a sign, symmetry, stability, braking, or driveline defect by tuning grip, damping, spring rate, steering ratio, torque split, brake bias, assists, hidden yaw damping, or test-only behavior.',
    'Validation must measure normal simulation behavior. Do not propose validation-only force, pose, yaw, grip, acceleration, braking, steering, or stability overrides.',
    'Any physics change must identify the mirrored case and name deterministic regression tests. Changes that can affect overall M5 behavior should include npm run test:m5-validation:strict in tests_to_run.',
    'Only reason from the repository snapshot included in this request. Do not assume access to any other file, secret, service, branch, issue, or network resource.',
    'Do not request, infer, reproduce, or expose credentials, environment variables, API keys, private data, or hidden files.',
    `Allowed change roots: ${AGENT_SCOPE.roots.map(r => `${r}/**`).join(', ')}. Exact allowed files: ${AGENT_SCOPE.exactAllowed.join(', ')}.`,
    'If implementation is justified, propose a standard unified git diff and never include files outside the allowed scope.',
    'Do not claim tests were executed. List the exact commands the lead engineer should run.',
    'Preferred output: EXACTLY one JSON object and no Markdown fences or surrounding prose.',
    'Required JSON keys: summary, findings, files_inspected, files_proposed_for_change, patch, tests_to_run, risks, assumptions, unresolved_issues.',
    'patch must be null or a string containing a unified diff. All list-like fields must be JSON arrays.',
    'If a large unified diff makes JSON escaping unreliable, use the plain-text fallback envelope below instead of malformed JSON. Do not use Markdown fences around the envelope:',
    'MUSE_SUMMARY_BEGIN\n<summary>\nMUSE_SUMMARY_END',
    'MUSE_FILES_PROPOSED_FOR_CHANGE_BEGIN\n["src/example.ts"]\nMUSE_FILES_PROPOSED_FOR_CHANGE_END',
    'MUSE_PATCH_BEGIN\n<standard unified git diff or NONE>\nMUSE_PATCH_END',
    'MUSE_TESTS_BEGIN\n["npm run build"]\nMUSE_TESTS_END',
    'You may also include FINDINGS, FILES_INSPECTED, RISKS, ASSUMPTIONS, and UNRESOLVED_ISSUES blocks using the same MUSE_<NAME>_BEGIN / END convention.',
  ].join('\n');
}

function buildInput(task, context) {
  const files = context.files.map(file => `\n===== FILE: ${file.path} (${file.bytes} bytes) =====\n${file.content}\n===== END FILE =====`).join('\n');
  return `DELEGATED OBJECTIVE\n${task}\n\nREPOSITORY SNAPSHOT\n${files}`;
}

function normalizeResult(value) {
  const arrays = ['findings', 'files_inspected', 'files_proposed_for_change', 'tests_to_run', 'risks', 'assumptions', 'unresolved_issues'];
  const result = { ...value };
  result.summary = typeof result.summary === 'string' ? result.summary : '';
  for (const key of arrays) result[key] = Array.isArray(result[key]) ? result[key] : [];
  result.patch = typeof result.patch === 'string' && result.patch.trim() ? result.patch : null;
  return result;
}

function saveArtifact(rootDir, artifact) {
  const directory = path.join(rootDir, '.muse', 'artifacts');
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const target = path.join(directory, `${stamp}.json`);
  fs.writeFileSync(target, `${JSON.stringify(artifact, null, 2)}\n`, { mode: 0o600 });
  return path.relative(rootDir, target).split(path.sep).join('/');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { process.stdout.write(usage()); return; }
  const rootDir = repoRoot();
  const task = taskText(args, rootDir);
  if (!task) throw new Error('A non-empty --task or --task-file is required.');

  const context = collectContext(rootDir);
  if (args.dryRun) {
    console.log(JSON.stringify({
      status: 'dry_run',
      model: MUSE_MODEL,
      endpoint: ZEN_ENDPOINT,
      task,
      context_bytes: context.totalBytes,
      files: context.files.map(file => file.path),
      writes: 'none',
    }, null, 2));
    return;
  }

  const client = new OpenCodeZenClient();
  const response = await client.complete({ instructions: systemInstructions(), input: buildInput(task, context) });
  const modelResult = normalizeResult(parseMuseOutput(response.text));
  const validation = validatePatchScope(modelResult.patch);
  const artifact = {
    schema_version: 1,
    created_at: new Date().toISOString(),
    status: validation.ok ? 'completed' : 'rejected_patch',
    task,
    model: response.model || MUSE_MODEL,
    endpoint: ZEN_ENDPOINT,
    usage: response.usage,
    context: { bytes: context.totalBytes, files: context.files.map(file => file.path) },
    patch_validation: validation,
    result: modelResult,
    applied: false,
  };
  const artifactPath = args.save ? saveArtifact(rootDir, artifact) : null;
  console.log(JSON.stringify({
    status: artifact.status,
    summary: modelResult.summary,
    proposed_files: modelResult.files_proposed_for_change,
    patch_paths: validation.paths,
    artifact: artifactPath,
    applied: false,
  }, null, 2));
  if (!validation.ok) process.exitCode = 2;
}

main().catch(error => {
  console.error(JSON.stringify({ status: 'failed', error: String(error?.message || error).slice(0, 1000) }, null, 2));
  process.exitCode = 1;
});

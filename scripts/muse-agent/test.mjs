import assert from 'node:assert/strict';
import { isAllowedPath, isContextPath, validatePatchScope } from './policy.mjs';
import { extractResponseText } from './zen.mjs';

assert.equal(isAllowedPath('src/physics/vehicle/Vehicle.ts'), true);
assert.equal(isAllowedPath('src/physics/tests/TireModelTests.ts'), true);
assert.equal(isAllowedPath('src/App.tsx'), true);
assert.equal(isAllowedPath('public/example.json'), true);
assert.equal(isAllowedPath('index.html'), true);
assert.equal(isAllowedPath('package.json'), true);
assert.equal(isContextPath('AGENTS.md'), true);
assert.equal(isContextPath('PHYSICS_CONVENTIONS.md'), true);
assert.equal(isContextPath('M5_VALIDATION.md'), true);
assert.equal(isAllowedPath('AGENTS.md'), false);
assert.equal(isAllowedPath('.github/workflows/pages.yml'), false);
assert.equal(isContextPath('.github/workflows/pages.yml'), false);
assert.equal(isAllowedPath('.env'), false);
assert.equal(isAllowedPath('../package.json'), false);
assert.equal(isAllowedPath('artifacts/m5-validation/report.json'), false);

const safePatch = `diff --git a/src/physics/tests/TireModelTests.ts b/src/physics/tests/TireModelTests.ts
--- a/src/physics/tests/TireModelTests.ts
+++ b/src/physics/tests/TireModelTests.ts
@@ -1,1 +1,1 @@
-old
+new
`;
const safe = validatePatchScope(safePatch);
assert.equal(safe.ok, true);
assert.deepEqual(safe.paths, ['src/physics/tests/TireModelTests.ts']);

const unsafePatch = `diff --git a/.github/workflows/pages.yml b/.github/workflows/pages.yml
--- a/.github/workflows/pages.yml
+++ b/.github/workflows/pages.yml
@@ -1,1 +1,1 @@
-old
+new
`;
const unsafe = validatePatchScope(unsafePatch);
assert.equal(unsafe.ok, false);
assert.match(unsafe.error, /outside the allowlist/i);

const secretPatch = `diff --git a/src/.env b/src/.env
--- a/src/.env
+++ b/src/.env
@@ -1,1 +1,1 @@
-old
+new
`;
const secret = validatePatchScope(secretPatch);
assert.equal(secret.ok, false);
assert.match(secret.error, /outside the allowlist/i);

assert.equal(extractResponseText({ output_text: 'hello' }), 'hello');
assert.equal(extractResponseText({ output: [{ content: [{ type: 'output_text', text: 'hel' }, { type: 'output_text', text: 'lo' }] }] }), 'hello');

console.log('Muse agent policy/client parser tests passed.');

import fs from 'node:fs';
import path from 'node:path';

const PATCH_ROOTS = ['src', 'public'];
const PATCH_EXACT = new Set(['index.html']);
const CONTEXT_EXACT = new Set([
  'AGENTS.md',
  'M5_VALIDATION.md',
  'PHYSICS_CONVENTIONS.md',
  'README.md',
  'package.json',
  'vite.config.ts',
  'tsconfig.json',
]);
const TEXT_EXTENSIONS = new Set(['.css', '.html', '.js', '.json', '.jsx', '.md', '.mjs', '.ts', '.tsx', '.txt']);
const DENIED_SEGMENTS = new Set(['.git', '.github', '.muse', '.agents', 'artifacts', 'dist', 'node_modules']);
const MAX_FILE_BYTES = 180_000;
const MAX_CONTEXT_BYTES = 800_000;

function normalizeRepoPath(value) {
  const normalized = String(value || '').replaceAll('\\', '/').replace(/^\.\//, '').trim();
  if (!normalized || normalized.startsWith('/') || normalized.includes('\0')) throw new Error(`Invalid repository path: ${value}`);
  const parts = normalized.split('/');
  if (parts.some(part => !part || part === '.' || part === '..')) throw new Error(`Unsafe repository path: ${value}`);
  return parts.join('/');
}

function isSecretLike(repoPath) {
  if (repoPath.split('/').some(part => DENIED_SEGMENTS.has(part))) return true;
  return /(?:^|\/)(?:\.env(?:\.|$)|[^/]*(?:secret|credential|private[-_]?key)[^/]*)/i.test(repoPath);
}

export function isAllowedPath(value) {
  let repoPath;
  try { repoPath = normalizeRepoPath(value); } catch { return false; }
  if (isSecretLike(repoPath)) return false;
  if (PATCH_EXACT.has(repoPath)) return true;
  return PATCH_ROOTS.some(root => repoPath.startsWith(`${root}/`));
}

export function isContextPath(value) {
  let repoPath;
  try { repoPath = normalizeRepoPath(value); } catch { return false; }
  if (isSecretLike(repoPath)) return false;
  return isAllowedPath(repoPath) || CONTEXT_EXACT.has(repoPath);
}

function patchPath(raw) {
  const value = String(raw || '').trim().split('\t', 1)[0].trim();
  if (!value || value === '/dev/null') return null;
  return value.replace(/^[ab]\//, '');
}

export function validatePatchScope(patch) {
  const text = String(patch || '');
  if (!text.trim()) return { ok: true, paths: [] };
  if (Buffer.byteLength(text, 'utf8') > 300_000) return { ok: false, error: 'Patch exceeds the 300 KB safety limit.', paths: [] };

  const paths = new Set();
  for (const line of text.replace(/\r\n?/g, '\n').split('\n')) {
    if (line.startsWith('diff --git ')) {
      const match = line.match(/^diff --git a\/(.+?) b\/(.+)$/);
      if (!match) return { ok: false, error: `Malformed diff header: ${line}`, paths: [...paths] };
      paths.add(match[1]);
      paths.add(match[2]);
      continue;
    }
    if (line.startsWith('+++ ') || line.startsWith('--- ')) {
      const candidate = patchPath(line.slice(4));
      if (candidate) paths.add(candidate);
    }
  }

  if (!paths.size) return { ok: false, error: 'Patch contains no recognizable file paths.', paths: [] };
  const unsafe = [...paths].filter(candidate => !isAllowedPath(candidate));
  if (unsafe.length) return { ok: false, error: `Patch touches files outside the allowlist: ${unsafe.join(', ')}`, paths: [...paths] };
  return { ok: true, paths: [...paths].sort() };
}

function shouldInclude(repoPath, stat) {
  if (!stat.isFile() || stat.size > MAX_FILE_BYTES || !isContextPath(repoPath)) return false;
  const base = path.posix.basename(repoPath);
  if (base === 'package-lock.json' || base === 'pnpm-lock.yaml' || base === 'yarn.lock' || base === 'bun.lock') return false;
  return TEXT_EXTENSIONS.has(path.posix.extname(repoPath).toLowerCase()) || base === 'Dockerfile';
}

function walk(rootDir, absoluteDir, out) {
  for (const entry of fs.readdirSync(absoluteDir, { withFileTypes: true })) {
    if (entry.isSymbolicLink() || DENIED_SEGMENTS.has(entry.name)) continue;
    const absolute = path.join(absoluteDir, entry.name);
    const repoPath = path.relative(rootDir, absolute).split(path.sep).join('/');
    if (entry.isDirectory()) {
      walk(rootDir, absolute, out);
      continue;
    }
    const stat = fs.statSync(absolute);
    if (shouldInclude(repoPath, stat)) out.push({ path: repoPath, bytes: stat.size, content: fs.readFileSync(absolute, 'utf8') });
  }
}

export function collectContext(rootDir) {
  const files = [];
  for (const root of PATCH_ROOTS) {
    const absolute = path.join(rootDir, root);
    if (fs.existsSync(absolute)) walk(rootDir, absolute, files);
  }

  for (const repoPath of new Set([...PATCH_EXACT, ...CONTEXT_EXACT])) {
    const absolute = path.join(rootDir, ...repoPath.split('/'));
    if (!fs.existsSync(absolute)) continue;
    const stat = fs.statSync(absolute);
    if (shouldInclude(repoPath, stat)) files.push({ path: repoPath, bytes: stat.size, content: fs.readFileSync(absolute, 'utf8') });
  }

  const priority = new Map(['AGENTS.md', 'PHYSICS_CONVENTIONS.md', 'M5_VALIDATION.md', 'package.json', 'vite.config.ts', 'tsconfig.json'].map((p, i) => [p, i]));
  files.sort((a, b) => (priority.get(a.path) ?? 100) - (priority.get(b.path) ?? 100) || a.path.localeCompare(b.path));

  const selected = [];
  let total = 0;
  const seen = new Set();
  for (const file of files) {
    if (seen.has(file.path)) continue;
    seen.add(file.path);
    if (total + file.bytes > MAX_CONTEXT_BYTES) continue;
    selected.push(file);
    total += file.bytes;
  }
  return { files: selected, totalBytes: total };
}

export const AGENT_SCOPE = Object.freeze({
  roots: [...PATCH_ROOTS],
  exactAllowed: [...PATCH_EXACT].sort(),
  contextOnly: [...CONTEXT_EXACT].filter(p => !PATCH_EXACT.has(p)).sort(),
  maxContextBytes: MAX_CONTEXT_BYTES,
  maxFileBytes: MAX_FILE_BYTES,
});

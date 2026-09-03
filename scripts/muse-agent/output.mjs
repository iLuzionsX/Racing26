const ARRAY_KEYS = [
  'findings',
  'files_inspected',
  'files_proposed_for_change',
  'tests_to_run',
  'risks',
  'assumptions',
  'unresolved_issues',
];

function parseObject(candidate) {
  try {
    const parsed = JSON.parse(candidate);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function markerBlock(text, name) {
  const startToken = `MUSE_${name}_BEGIN`;
  const endToken = `MUSE_${name}_END`;
  const start = text.indexOf(startToken);
  if (start < 0) return '';
  const bodyStart = start + startToken.length;
  const end = text.indexOf(endToken, bodyStart);
  if (end < 0) return '';
  return text.slice(bodyStart, end).trim();
}

function parseArrayBlock(text, name) {
  const block = markerBlock(text, name);
  if (!block) return [];
  try {
    const value = JSON.parse(block);
    return Array.isArray(value) ? value : [];
  } catch {
    return block.split('\n').map(line => line.replace(/^[-*]\s*/, '').trim()).filter(Boolean);
  }
}

function extractPatch(text) {
  const marker = markerBlock(text, 'PATCH');
  if (marker && marker.toUpperCase() !== 'NONE' && marker.toUpperCase() !== 'NULL') return marker;

  const fenced = text.match(/```(?:diff|patch)\s*\n([\s\S]*?)```/i);
  if (fenced?.[1]?.trim()) return fenced[1].trim();

  const diffStart = text.indexOf('diff --git ');
  if (diffStart >= 0) {
    const tail = text.slice(diffStart).trim();
    const fenceEnd = tail.indexOf('\n```');
    return (fenceEnd >= 0 ? tail.slice(0, fenceEnd) : tail).trim();
  }

  return null;
}

export function parseMuseOutput(raw) {
  const text = String(raw || '').trim();
  if (!text) throw new Error('Muse returned an empty response.');

  const attempts = [text];
  const jsonFence = text.match(/```(?:json)?\s*\n?([\s\S]*?)```/i);
  if (jsonFence?.[1]) attempts.push(jsonFence[1].trim());
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first >= 0 && last > first) attempts.push(text.slice(first, last + 1));

  for (const candidate of attempts) {
    const parsed = parseObject(candidate);
    if (parsed) return parsed;
  }

  const patch = extractPatch(text);
  const summary = markerBlock(text, 'SUMMARY') || text.slice(0, patch ? Math.max(0, text.indexOf(patch)) : 1400).trim();
  const result = {
    summary: summary.slice(0, 4000),
    findings: parseArrayBlock(text, 'FINDINGS'),
    files_inspected: parseArrayBlock(text, 'FILES_INSPECTED'),
    files_proposed_for_change: parseArrayBlock(text, 'FILES_PROPOSED_FOR_CHANGE'),
    patch,
    tests_to_run: parseArrayBlock(text, 'TESTS'),
    risks: parseArrayBlock(text, 'RISKS'),
    assumptions: parseArrayBlock(text, 'ASSUMPTIONS'),
    unresolved_issues: parseArrayBlock(text, 'UNRESOLVED_ISSUES'),
  };

  if (!patch && result.unresolved_issues.length === 0) {
    result.unresolved_issues.push('Muse returned unstructured prose without a patch.');
  }

  for (const key of ARRAY_KEYS) {
    if (!Array.isArray(result[key])) result[key] = [];
  }
  return result;
}

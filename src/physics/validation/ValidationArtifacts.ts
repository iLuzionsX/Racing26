import { mkdirSync, writeFileSync } from 'node:fs';

const finite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const csvCell = (value: unknown): string => {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

export function ensureArtifactDir(dir: string) {
  mkdirSync(dir, { recursive: true });
}

export function writeJson(path: string, value: unknown) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

export function writeRowsCsv(path: string, rows: Record<string, unknown>[]) {
  if (rows.length === 0) {
    writeFileSync(path, '', 'utf8');
    return;
  }
  const headers = Array.from(new Set(rows.flatMap((row) => Object.keys(row))));
  const lines = [
    headers.map(csvCell).join(','),
    ...rows.map((row) => headers.map((header) => csvCell(row[header])).join(',')),
  ];
  writeFileSync(path, `${lines.join('\n')}\n`, 'utf8');
}

export interface LineSeries {
  name: string;
  values: number[];
}

export interface LineChartOptions {
  title: string;
  subtitle?: string;
  xLabel: string;
  yLabel: string;
  x: number[];
  series: LineSeries[];
  width?: number;
  height?: number;
  markerX?: number;
  markerLabel?: string;
}

/** Dependency-free SVG graphing so CI can always publish engineering traces. */
export function writeLineChartSvg(path: string, options: LineChartOptions) {
  const width = options.width ?? 1120;
  const height = options.height ?? 520;
  const left = 90;
  const right = 34;
  const top = 92;
  const bottom = 68;
  const plotW = width - left - right;
  const plotH = height - top - bottom;

  const xValues = options.x.filter(Number.isFinite);
  const yValues = options.series.flatMap((series) => series.values).filter(Number.isFinite);
  if (xValues.length === 0 || yValues.length === 0) return;

  let minX = Math.min(...xValues);
  let maxX = Math.max(...xValues);
  let minY = Math.min(0, ...yValues);
  let maxY = Math.max(0, ...yValues);
  if (Math.abs(maxX - minX) < 1e-9) maxX = minX + 1;
  if (Math.abs(maxY - minY) < 1e-9) {
    minY -= 1;
    maxY += 1;
  }
  const yPad = (maxY - minY) * 0.08;
  minY -= yPad;
  maxY += yPad;

  const xFor = (v: number) => left + ((v - minX) / (maxX - minX)) * plotW;
  const yFor = (v: number) => top + plotH - ((v - minY) / (maxY - minY)) * plotH;
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const colors = ['#2563eb', '#dc2626', '#059669', '#7c3aed', '#d97706', '#0891b2', '#4f46e5', '#be123c'];

  const svg: string[] = [];
  svg.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`);
  svg.push('<rect width="100%" height="100%" fill="#ffffff"/>');
  svg.push(`<text x="${left}" y="36" font-family="system-ui, sans-serif" font-size="24" font-weight="700" fill="#111827">${esc(options.title)}</text>`);
  if (options.subtitle) {
    svg.push(`<text x="${left}" y="61" font-family="system-ui, sans-serif" font-size="13" fill="#4b5563">${esc(options.subtitle)}</text>`);
  }
  svg.push(`<rect x="${left}" y="${top}" width="${plotW}" height="${plotH}" fill="#f9fafb" stroke="#d1d5db"/>`);

  for (let tick = 0; tick <= 5; tick++) {
    const xValue = minX + (maxX - minX) * tick / 5;
    const x = xFor(xValue);
    svg.push(`<line x1="${x.toFixed(2)}" y1="${top}" x2="${x.toFixed(2)}" y2="${top + plotH}" stroke="#e5e7eb"/>`);
    svg.push(`<text x="${x.toFixed(2)}" y="${top + plotH + 22}" text-anchor="middle" font-family="system-ui, sans-serif" font-size="11" fill="#6b7280">${xValue.toFixed(2)}</text>`);
  }
  for (let tick = 0; tick <= 5; tick++) {
    const yValue = minY + (maxY - minY) * tick / 5;
    const y = yFor(yValue);
    svg.push(`<line x1="${left}" y1="${y.toFixed(2)}" x2="${left + plotW}" y2="${y.toFixed(2)}" stroke="#e5e7eb"/>`);
    svg.push(`<text x="${left - 10}" y="${(y + 4).toFixed(2)}" text-anchor="end" font-family="system-ui, sans-serif" font-size="11" fill="#6b7280">${yValue.toFixed(2)}</text>`);
  }

  if (finite(options.markerX) && options.markerX >= minX && options.markerX <= maxX) {
    const x = xFor(options.markerX);
    svg.push(`<line x1="${x.toFixed(2)}" y1="${top}" x2="${x.toFixed(2)}" y2="${top + plotH}" stroke="#111827" stroke-width="1.2" stroke-dasharray="6 5" opacity="0.65"/>`);
    if (options.markerLabel) {
      svg.push(`<text x="${(x + 7).toFixed(2)}" y="${top + 16}" font-family="system-ui, sans-serif" font-size="11" fill="#374151">${esc(options.markerLabel)}</text>`);
    }
  }

  let legendX = left + 8;
  options.series.forEach((series, seriesIndex) => {
    const color = colors[seriesIndex % colors.length];
    const points = options.x
      .map((xValue, i) => {
        const yValue = series.values[i];
        return Number.isFinite(xValue) && Number.isFinite(yValue)
          ? `${xFor(xValue).toFixed(2)},${yFor(yValue).toFixed(2)}`
          : null;
      })
      .filter(Boolean)
      .join(' ');
    if (points) {
      svg.push(`<polyline points="${points}" fill="none" stroke="${color}" stroke-width="2.1" stroke-linejoin="round" stroke-linecap="round"/>`);
    }
    svg.push(`<line x1="${legendX}" y1="${top + 18}" x2="${legendX + 20}" y2="${top + 18}" stroke="${color}" stroke-width="3"/>`);
    svg.push(`<text x="${legendX + 27}" y="${top + 22}" font-family="system-ui, sans-serif" font-size="11" fill="#374151">${esc(series.name)}</text>`);
    legendX += 54 + series.name.length * 6.8;
  });

  svg.push(`<text x="${left + plotW / 2}" y="${height - 22}" text-anchor="middle" font-family="system-ui, sans-serif" font-size="12" fill="#4b5563">${esc(options.xLabel)}</text>`);
  svg.push(`<text x="20" y="${top + plotH / 2}" transform="rotate(-90 20 ${top + plotH / 2})" text-anchor="middle" font-family="system-ui, sans-serif" font-size="12" fill="#4b5563">${esc(options.yLabel)}</text>`);
  svg.push('</svg>');
  writeFileSync(path, `${svg.join('\n')}\n`, 'utf8');
}

const fmt = (value: unknown): string => {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return 'n/a';
    if (Math.abs(value) >= 1000) return value.toFixed(0);
    if (Math.abs(value) >= 100) return value.toFixed(1);
    return value.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
  }
  if (value === null || value === undefined || value === '') return 'n/a';
  return String(value);
};

export function buildMarkdownReport(report: any): string {
  const lines: string[] = [];
  lines.push('# 2025 BMW M5 Vehicle Dynamics Validation');
  lines.push('');
  lines.push(`Generated: ${report.generatedAt}`);
  lines.push(`Physics step: ${fmt(report.fixedDtSec)} s (${fmt(1 / report.fixedDtSec)} Hz)`);
  lines.push(`Configuration: ${report.vehicleConfiguration}`);
  lines.push('');
  lines.push('## Status summary');
  lines.push('');
  lines.push(`- PASS: ${report.statusCounts.PASS ?? 0}`);
  lines.push(`- WARNING: ${report.statusCounts.WARNING ?? 0}`);
  lines.push(`- FAIL: ${report.statusCounts.FAIL ?? 0}`);
  lines.push(`- NO REFERENCE DATA: ${report.statusCounts['NO REFERENCE DATA'] ?? 0}`);
  lines.push('');

  for (const result of report.results) {
    lines.push(`## ${result.name}`);
    lines.push('');
    lines.push(`**Status:** ${result.status}`);
    lines.push(`**Validation class:** ${result.validationClass}`);
    if (result.reference?.source) lines.push(`**Reference:** ${result.reference.source}`);
    if (result.summary) lines.push(`**Summary:** ${result.summary}`);
    lines.push('');
    if (result.metrics && Object.keys(result.metrics).length > 0) {
      lines.push('| Metric | Value |');
      lines.push('|---|---:|');
      for (const [key, value] of Object.entries(result.metrics)) {
        lines.push(`| ${key} | ${fmt(value)} |`);
      }
      lines.push('');
    }
    if (result.diagnostics?.length) {
      lines.push('Diagnostics:');
      for (const diagnostic of result.diagnostics) lines.push(`- ${diagnostic}`);
      lines.push('');
    }
  }

  lines.push('## Reference data still needed');
  lines.push('');
  for (const item of report.referenceDataNeeded ?? []) lines.push(`- ${item}`);
  lines.push('');

  if (report.regressionDeltas?.length) {
    lines.push('## Regression deltas');
    lines.push('');
    lines.push('| Metric | Before | After | Delta |');
    lines.push('|---|---:|---:|---:|');
    for (const delta of report.regressionDeltas) {
      lines.push(`| ${delta.metric} | ${fmt(delta.before)} | ${fmt(delta.after)} | ${fmt(delta.percent)}% |`);
    }
    lines.push('');
  }

  lines.push('## Interpretation rule');
  lines.push('');
  lines.push('A passing framework is not evidence that the M5 is realistic. Physics claims are only supported where the simulation metric and a measured or engineering-supported reference agree under comparable conditions.');
  lines.push('');
  return `${lines.join('\n')}\n`;
}

export function writeMarkdown(path: string, report: any) {
  writeFileSync(path, buildMarkdownReport(report), 'utf8');
}

import { mkdirSync, writeFileSync } from 'node:fs';
import { Simulation } from '../Simulation';
import { DEFAULT_VEHICLE_CONFIG } from '../vehiclePresets';
import { BMW_M5_2025_OVERRIDES } from '../m5G90';
import { PhysicsMath } from '../math/PhysicsMath';

const config = { ...DEFAULT_VEHICLE_CONFIG, ...BMW_M5_2025_OVERRIDES } as any;
const dt = 1 / 120;
const radToDeg = 180 / Math.PI;
const neutral = {
  throttle: 0,
  brake: 0,
  steer: 0,
  handbrake: false,
  shiftUp: false,
  shiftDown: false,
};

type TraceRow = {
  t: number;
  steerDeg: number;
  frontSlipDeg: number;
  lateralG: number;
  yawRateDegS: number;
  rollDeg: number;
  fz: [number, number, number, number];
};

const sim = new Simulation(config);
sim.reset(0, 0, 0);
for (let i = 0; i < 300; i++) sim.stepExplicit(neutral, 1);

const speedMs = 20; // 72 km/h
sim.vehicle.rigidBody.velocity = PhysicsMath.vec3(0, 0, speedMs);
sim.vehicle.wheels.forEach((wheel) => wheel.reset(speedMs));
for (let i = 0; i < 60; i++) sim.stepExplicit(neutral, 1);

const targetCenterSteerRad = 3.2 * Math.PI / 180;
const steerInput = targetCenterSteerRad / config.maxSteerAngle;
const steeringDurationSec = 1.5;
const releaseDurationSec = 1.5;
const steeringSteps = Math.round(steeringDurationSec / dt);
const releaseSteps = Math.round(releaseDurationSec / dt);
const rows: TraceRow[] = [];

const capture = (t: number) => {
  const state = sim.vehicle.getState();
  rows.push({
    t,
    steerDeg: state.actualSteerAngle * radToDeg,
    frontSlipDeg: 0.5 * (state.wheels[0].slipAngle + state.wheels[1].slipAngle) * radToDeg,
    lateralG: state.lateralG,
    yawRateDegS: state.yawRate * radToDeg,
    rollDeg: state.roll * radToDeg,
    fz: [
      state.wheels[0].forceVectorNorm,
      state.wheels[1].forceVectorNorm,
      state.wheels[2].forceVectorNorm,
      state.wheels[3].forceVectorNorm,
    ],
  });
};

capture(0);
for (let step = 0; step < steeringSteps; step++) {
  sim.stepExplicit({ ...neutral, steer: steerInput }, 1);
  capture((step + 1) * dt);
}
for (let step = 0; step < releaseSteps; step++) {
  sim.stepExplicit(neutral, 1);
  capture(steeringDurationSec + (step + 1) * dt);
}

const artifactDir = 'artifacts';
mkdirSync(artifactDir, { recursive: true });

const csvHeader = 'time_s,steer_deg,front_slip_deg,lateral_g,yaw_rate_deg_s,roll_deg,fz_fl_n,fz_fr_n,fz_rl_n,fz_rr_n';
const csv = [
  csvHeader,
  ...rows.map((r) => [
    r.t.toFixed(5),
    r.steerDeg.toFixed(6),
    r.frontSlipDeg.toFixed(6),
    r.lateralG.toFixed(7),
    r.yawRateDegS.toFixed(6),
    r.rollDeg.toFixed(6),
    ...r.fz.map((v) => v.toFixed(3)),
  ].join(',')),
].join('\n');
writeFileSync(`${artifactDir}/m5-chassis-steering-step.csv`, `${csv}\n`, 'utf8');

const width = 1200;
const panelHeight = 225;
const panelGap = 22;
const top = 105;
const left = 92;
const right = 35;
const plotWidth = width - left - right;
const panelCount = 5;
const height = top + panelCount * panelHeight + (panelCount - 1) * panelGap + 82;
const totalTime = steeringDurationSec + releaseDurationSec;

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const xFor = (t: number) => left + (t / totalTime) * plotWidth;

const finiteRange = (series: number[][], includeZero = true): [number, number] => {
  const values = series.flat().filter(Number.isFinite);
  if (includeZero) values.push(0);
  let min = Math.min(...values);
  let max = Math.max(...values);
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [-1, 1];
  if (Math.abs(max - min) < 1e-9) {
    const pad = Math.max(1, Math.abs(max) * 0.2);
    return [min - pad, max + pad];
  }
  const pad = (max - min) * 0.12;
  min -= pad;
  max += pad;
  return [min, max];
};

const colors = ['#2563eb', '#dc2626', '#059669', '#7c3aed', '#d97706', '#0891b2'];

const panels = [
  {
    title: 'Steering and front tire slip',
    unit: 'deg',
    series: [
      { name: 'Road-wheel steer', values: rows.map((r) => r.steerDeg), color: colors[0] },
      { name: 'Front slip angle', values: rows.map((r) => r.frontSlipDeg), color: colors[1] },
    ],
  },
  {
    title: 'Lateral acceleration',
    unit: 'g',
    series: [{ name: 'Lateral G', values: rows.map((r) => r.lateralG), color: colors[2] }],
  },
  {
    title: 'Yaw response',
    unit: 'deg/s',
    series: [{ name: 'Yaw rate', values: rows.map((r) => r.yawRateDegS), color: colors[3] }],
  },
  {
    title: 'Body roll',
    unit: 'deg',
    series: [{ name: 'Roll angle', values: rows.map((r) => r.rollDeg), color: colors[4] }],
  },
  {
    title: 'Individual tire normal loads',
    unit: 'kN',
    series: [
      { name: 'FL', values: rows.map((r) => r.fz[0] / 1000), color: '#1d4ed8' },
      { name: 'FR', values: rows.map((r) => r.fz[1] / 1000), color: '#ef4444' },
      { name: 'RL', values: rows.map((r) => r.fz[2] / 1000), color: '#0f766e' },
      { name: 'RR', values: rows.map((r) => r.fz[3] / 1000), color: '#a16207' },
    ],
  },
];

const svg: string[] = [];
svg.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`);
svg.push('<rect width="100%" height="100%" fill="#ffffff"/>');
svg.push(`<text x="${left}" y="42" font-family="system-ui, sans-serif" font-size="25" font-weight="700" fill="#111827">2025 BMW M5 chassis transient — 72 km/h steering step</text>`);
svg.push(`<text x="${left}" y="70" font-family="system-ui, sans-serif" font-size="14" fill="#4b5563">3.2° road-wheel request held for ${steeringDurationSec.toFixed(1)} s, then released. Physics sampled at 120 Hz.</text>`);
svg.push(`<text x="${left}" y="91" font-family="system-ui, sans-serif" font-size="13" fill="#6b7280">Sequence target: steering → slip → lateral force/yaw → load transfer → roll → decay.</text>`);

panels.forEach((panel, panelIndex) => {
  const y0 = top + panelIndex * (panelHeight + panelGap);
  const plotTop = y0 + 31;
  const plotBottom = y0 + panelHeight - 28;
  const plotHeight = plotBottom - plotTop;
  const [minY, maxY] = finiteRange(panel.series.map((s) => s.values));
  const yFor = (v: number) => plotBottom - ((v - minY) / (maxY - minY)) * plotHeight;

  svg.push(`<text x="${left}" y="${y0 + 19}" font-family="system-ui, sans-serif" font-size="16" font-weight="650" fill="#111827">${esc(panel.title)}</text>`);
  svg.push(`<rect x="${left}" y="${plotTop}" width="${plotWidth}" height="${plotHeight}" fill="#f9fafb" stroke="#d1d5db"/>`);

  for (let tick = 0; tick <= 4; tick++) {
    const value = minY + (maxY - minY) * (tick / 4);
    const y = yFor(value);
    svg.push(`<line x1="${left}" y1="${y.toFixed(2)}" x2="${left + plotWidth}" y2="${y.toFixed(2)}" stroke="#e5e7eb" stroke-width="1"/>`);
    svg.push(`<text x="${left - 10}" y="${(y + 4).toFixed(2)}" text-anchor="end" font-family="system-ui, sans-serif" font-size="11" fill="#6b7280">${value.toFixed(panel.unit === 'kN' ? 1 : 2)}</text>`);
  }

  for (let tick = 0; tick <= 6; tick++) {
    const t = totalTime * (tick / 6);
    const x = xFor(t);
    svg.push(`<line x1="${x.toFixed(2)}" y1="${plotTop}" x2="${x.toFixed(2)}" y2="${plotBottom}" stroke="#eef0f3" stroke-width="1"/>`);
    if (panelIndex === panels.length - 1) {
      svg.push(`<text x="${x.toFixed(2)}" y="${plotBottom + 19}" text-anchor="middle" font-family="system-ui, sans-serif" font-size="11" fill="#6b7280">${t.toFixed(1)}</text>`);
    }
  }

  const releaseX = xFor(steeringDurationSec);
  svg.push(`<line x1="${releaseX.toFixed(2)}" y1="${plotTop}" x2="${releaseX.toFixed(2)}" y2="${plotBottom}" stroke="#111827" stroke-width="1.2" stroke-dasharray="5 5" opacity="0.65"/>`);
  if (panelIndex === 0) {
    svg.push(`<text x="${(releaseX + 7).toFixed(2)}" y="${plotTop + 14}" font-family="system-ui, sans-serif" font-size="11" fill="#374151">steering release</text>`);
  }

  panel.series.forEach((series) => {
    const points = rows.map((r, i) => `${xFor(r.t).toFixed(2)},${yFor(series.values[i]).toFixed(2)}`).join(' ');
    svg.push(`<polyline points="${points}" fill="none" stroke="${series.color}" stroke-width="2.1" stroke-linejoin="round" stroke-linecap="round"/>`);
  });

  let legendX = left + 8;
  panel.series.forEach((series) => {
    svg.push(`<line x1="${legendX}" y1="${plotTop + 16}" x2="${legendX + 22}" y2="${plotTop + 16}" stroke="${series.color}" stroke-width="3"/>`);
    svg.push(`<text x="${legendX + 28}" y="${plotTop + 20}" font-family="system-ui, sans-serif" font-size="11" fill="#374151">${esc(series.name)}</text>`);
    legendX += 28 + series.name.length * 7 + 30;
  });

  svg.push(`<text x="20" y="${(plotTop + plotHeight / 2).toFixed(2)}" transform="rotate(-90 20 ${(plotTop + plotHeight / 2).toFixed(2)})" text-anchor="middle" font-family="system-ui, sans-serif" font-size="11" fill="#6b7280">${esc(panel.unit)}</text>`);
});

const lastPanelBottom = top + (panelCount - 1) * (panelHeight + panelGap) + panelHeight - 28;
svg.push(`<text x="${left + plotWidth / 2}" y="${lastPanelBottom + 48}" text-anchor="middle" font-family="system-ui, sans-serif" font-size="12" fill="#4b5563">time (s)</text>`);
svg.push('</svg>');
writeFileSync(`${artifactDir}/m5-chassis-steering-step.svg`, `${svg.join('\n')}\n`, 'utf8');

console.log(`M5 chassis trace artifacts written: ${rows.length} samples`);
console.log(`- ${artifactDir}/m5-chassis-steering-step.csv`);
console.log(`- ${artifactDir}/m5-chassis-steering-step.svg`);

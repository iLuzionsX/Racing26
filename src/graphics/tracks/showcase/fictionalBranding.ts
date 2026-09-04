import * as THREE from 'three';

/** Fictional-only circuit sponsors. No real trademarks. */
export interface FictionalBrand {
  id: string;
  displayName: string;
  shortCode: string;
  primary: string;
  secondary: string;
  accent: string;
}

export const FICTIONAL_BRANDS: readonly FictionalBrand[] = [
  { id: 'velocita', displayName: 'VELOCITA', shortCode: 'VEL', primary: '#0e3a5d', secondary: '#f2f5f7', accent: '#38bdf8' },
  { id: 'apexa', displayName: 'APEXA DYNAMICS', shortCode: 'APX', primary: '#1b2430', secondary: '#e8edf2', accent: '#f59e0b' },
  { id: 'nordlys', displayName: 'NORDLYS', shortCode: 'NLY', primary: '#123f31', secondary: '#eef7f0', accent: '#34d399' },
  { id: 'kairos', displayName: 'KAIROS TIMING', shortCode: 'KAI', primary: '#2b2b33', secondary: '#f8fafc', accent: '#e2e8f0' },
  { id: 'strada', displayName: 'STRADA CORSE', shortCode: 'STD', primary: '#5d1010', secondary: '#fdf2f2', accent: '#fca5a5' },
  { id: 'lumen', displayName: 'LUMEN GP', shortCode: 'LMN', primary: '#10233f', secondary: '#e0f2fe', accent: '#22d3ee' },
  { id: 'pulse', displayName: 'PULSE LUBRICANTS', shortCode: 'PLS', primary: '#3b2f0b', secondary: '#fefce8', accent: '#facc15' },
  { id: 'aerofab', displayName: 'AEROFAB', shortCode: 'AER', primary: '#334155', secondary: '#f1f5f9', accent: '#94a3b8' },
];

export function listFictionalBrands(): FictionalBrand[] {
  return [...FICTIONAL_BRANDS];
}

export function getFictionalBrand(id: string): FictionalBrand {
  const found = FICTIONAL_BRANDS.find((b) => b.id === id);
  return found ?? FICTIONAL_BRANDS[0];
}

/** Deterministic sector-to-sponsor mapping for storytelling continuity. */
export function fictionalBrandForSector(u: number): FictionalBrand {
  const wrapped = ((u % 1) + 1) % 1;
  const index = Math.floor(wrapped * FICTIONAL_BRANDS.length) % FICTIONAL_BRANDS.length;
  return FICTIONAL_BRANDS[index];
}

export interface FictionalBannerOptions {
  widthPx?: number;
  heightPx?: number;
  subText?: string;
}

function canvas2d(width: number, height: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  return [canvas, ctx];
}

/** Shared deterministic banner texture. Caller owns disposal. */
export function makeFictionalBannerTexture(brandId: string, opts: FictionalBannerOptions = {}): THREE.CanvasTexture {
  const brand = getFictionalBrand(brandId);
  const w = Math.max(32, Math.min(256, opts.widthPx ?? 256));
  const h = Math.max(16, Math.min(256, opts.heightPx ?? 64));
  const [canvas, ctx] = canvas2d(w, h);
  ctx.fillStyle = brand.primary;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = brand.accent;
  ctx.fillRect(0, h - Math.max(2, Math.floor(h * 0.12)), w, Math.max(2, Math.floor(h * 0.12)));
  ctx.fillStyle = brand.secondary;
  ctx.font = `900 ${Math.floor(h * 0.42)}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(brand.displayName, w / 2, h * 0.42);
  if (opts.subText) {
    ctx.font = `700 ${Math.floor(h * 0.20)}px system-ui, sans-serif`;
    ctx.fillText(opts.subText, w / 2, h * 0.74);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

export function makeFictionalBannerMaterial(brandId: string, opts: FictionalBannerOptions = {}): THREE.MeshBasicMaterial {
  const tex = makeFictionalBannerTexture(brandId, opts);
  return new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide });
}

/** High-contrast number board (braking boards, sector markers). */
export function makeFictionalNumberTexture(text: string): THREE.CanvasTexture {
  const [canvas, ctx] = canvas2d(128, 128);
  ctx.fillStyle = '#f8fafc';
  ctx.fillRect(0, 0, 128, 128);
  ctx.strokeStyle = '#111827';
  ctx.lineWidth = 8;
  ctx.strokeRect(4, 4, 120, 120);
  ctx.fillStyle = '#b91c1c';
  ctx.fillRect(4, 4, 120, 22);
  ctx.fillStyle = '#111827';
  ctx.font = '900 52px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 64, 72);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Simple blue/white information board (PIT IN/OUT, GATE, SECTOR). */
export function makeFictionalInfoTexture(title: string, sub = ''): THREE.CanvasTexture {
  const [canvas, ctx] = canvas2d(256, 128);
  ctx.fillStyle = '#0f3a8a';
  ctx.fillRect(0, 0, 256, 128);
  ctx.strokeStyle = '#f8fafc';
  ctx.lineWidth = 6;
  ctx.strokeRect(5, 5, 246, 118);
  ctx.fillStyle = '#ffffff';
  ctx.font = '900 40px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(title, 128, sub ? 48 : 64);
  if (sub) {
    ctx.font = '700 24px system-ui, sans-serif';
    ctx.fillText(sub, 128, 92);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

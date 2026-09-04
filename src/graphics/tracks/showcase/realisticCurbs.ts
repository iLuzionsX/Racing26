import * as THREE from 'three';

export interface EdgeTrackSample {
  center: THREE.Vector3;
  tangent: THREE.Vector3;
  lateral: THREE.Vector3;
  bankedLateral: THREE.Vector3;
  normal: THREE.Vector3;
}
export interface EdgeTrackPath {
  lengthM: number;
  sampleAt(u: number): EdgeTrackSample;
}

export interface RealisticCurbZone {
  startU: number;
  lengthU: number;
  side: -1 | 1;
  apexU: number;
  maxCurvature: number;
  approxLengthM: number;
}

export const CURB_SYSTEM_KIND = 'continuous-ribbon';
export const CURB_EDGE_LINE_WIDTH_M = 0.16;
export const CURB_STRIPE_LENGTH_M = 4.0;
export const CURB_EDGE_DRAW_CALLS = 3;
export const CURB_RED_HEX = 0xad3e39;
export const CURB_WHITE_HEX = 0xded8ce;
export const CURB_VISUAL_PROFILE_M = [0.004, 0.015, 0.020, 0.010] as const;
export const CURB_PROFILE_FRACTIONS = [0, 0.16, 0.68, 1] as const;

function wrapU(u: number): number {
  return ((u % 1) + 1) % 1;
}

function signedAngleXZ(a: THREE.Vector3, b: THREE.Vector3): number {
  const dot = THREE.MathUtils.clamp(a.x * b.x + a.z * b.z, -1, 1);
  const crossY = a.z * b.x - a.x * b.z;
  return Math.atan2(crossY, dot);
}

export function signedCurvatureAt(path: EdgeTrackPath, u: number, sampleCount = 720): number {
  const du = 1 / sampleCount;
  const prev = path.sampleAt(wrapU(u - du));
  const next = path.sampleAt(wrapU(u + du));
  const ds = Math.max(0.25, (path.lengthM * 2) / sampleCount);
  return signedAngleXZ(prev.tangent, next.tangent) / ds;
}

export function deriveRealisticCurbZones(path: EdgeTrackPath, sampleCount = 720): RealisticCurbZone[] {
  const raw = new Array<number>(sampleCount);
  for (let i = 0; i < sampleCount; i++) raw[i] = signedCurvatureAt(path, i / sampleCount, sampleCount);

  const smooth = new Array<number>(sampleCount).fill(0);
  const radius = 4;
  for (let i = 0; i < sampleCount; i++) {
    let sum = 0;
    let weight = 0;
    for (let k = -radius; k <= radius; k++) {
      const w = radius + 1 - Math.abs(k);
      sum += raw[(i + k + sampleCount) % sampleCount] * w;
      weight += w;
    }
    smooth[i] = sum / weight;
  }

  let anchor = 0;
  for (let i = 1; i < sampleCount; i++) {
    if (Math.abs(smooth[i]) < Math.abs(smooth[anchor])) anchor = i;
  }

  // Enter near ~180 m radius and hold through ~260 m radius so kerbs stay
  // corner-specific instead of painting every gentle sweep.
  const enterThreshold = 1 / 180;
  const holdThreshold = 1 / 260;
  const maxGapSamples = 4;
  const minZoneM = 28;
  const zones: RealisticCurbZone[] = [];

  let active: { sign: -1 | 1; indices: number[]; trailingGap: number } | null = null;


  for (let j = 0; j < sampleCount; j++) {
    const idx = (anchor + 1 + j) % sampleCount;
    const k = smooth[idx];
    const abs = Math.abs(k);
    const sign: -1 | 1 = k >= 0 ? 1 : -1;

    if (!active) {
      if (abs >= enterThreshold) active = { sign, indices: [idx], trailingGap: 0 };
      continue;
    }

    if (sign === active.sign && abs >= holdThreshold) {
      active.indices.push(idx);
      active.trailingGap = 0;
      continue;
    }

    if (sign === active.sign && active.trailingGap < maxGapSamples) {
      active.indices.push(idx);
      active.trailingGap++;
      continue;
    }

    const previous = active;
    const trimmed = previous.trailingGap > 0
      ? previous.indices.slice(0, Math.max(0, previous.indices.length - previous.trailingGap))
      : previous.indices;
    active = null;

    if (trimmed.length) {
      const zoneLengthM = (trimmed.length / sampleCount) * path.lengthM;
      if (zoneLengthM >= minZoneM) {
        let apexIndex = trimmed[0];
        for (const sampleIndex of trimmed) {
          if (Math.abs(smooth[sampleIndex]) > Math.abs(smooth[apexIndex])) apexIndex = sampleIndex;
        }
        const maxCurvature = Math.abs(smooth[apexIndex]);
        if (maxCurvature >= enterThreshold) {
          const preM = THREE.MathUtils.clamp(zoneLengthM * 0.34, 14, 34);
          const postM = THREE.MathUtils.clamp(zoneLengthM * 0.46, 20, 44);
          const apexU = apexIndex / sampleCount;
          zones.push({
            startU: wrapU(apexU - preM / path.lengthM),
            lengthU: (preM + postM) / path.lengthM,
            side: previous.sign,
            apexU,
            maxCurvature,
            approxLengthM: preM + postM,
          });
        }
      }
    }

    if (abs >= enterThreshold) active = { sign, indices: [idx], trailingGap: 0 };
  }

  if (active) {
    const previous = active;
    const trimmed = previous.trailingGap > 0
      ? previous.indices.slice(0, Math.max(0, previous.indices.length - previous.trailingGap))
      : previous.indices;
    if (trimmed.length) {
      const zoneLengthM = (trimmed.length / sampleCount) * path.lengthM;
      if (zoneLengthM >= minZoneM) {
        let apexIndex = trimmed[0];
        for (const sampleIndex of trimmed) {
          if (Math.abs(smooth[sampleIndex]) > Math.abs(smooth[apexIndex])) apexIndex = sampleIndex;
        }
        const maxCurvature = Math.abs(smooth[apexIndex]);
        if (maxCurvature >= enterThreshold) {
          const preM = THREE.MathUtils.clamp(zoneLengthM * 0.34, 14, 34);
          const postM = THREE.MathUtils.clamp(zoneLengthM * 0.46, 20, 44);
          const apexU = apexIndex / sampleCount;
          zones.push({
            startU: wrapU(apexU - preM / path.lengthM),
            lengthU: (preM + postM) / path.lengthM,
            side: previous.sign,
            apexU,
            maxCurvature,
            approxLengthM: preM + postM,
          });
        }
      }
    }
  }

  return zones;
}

function seeded(seed: number): () => number {
  let v = seed >>> 0;
  return () => {
    v = (Math.imul(v, 1664525) + 1013904223) >>> 0;
    return v / 0x100000000;
  };
}

export function makeWeatheredCurbTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  const red = `#${CURB_RED_HEX.toString(16).padStart(6, '0')}`;
  const white = `#${CURB_WHITE_HEX.toString(16).padStart(6, '0')}`;
  ctx.fillStyle = red;
  ctx.fillRect(0, 0, 128, 128);
  ctx.fillStyle = white;
  ctx.fillRect(0, 128, 128, 128);

  const rng = seeded(0xc7b5);
  for (let i = 0; i < 1700; i++) {
    const x = rng() * 128;
    const y = rng() * 256;
    const alpha = 0.05 + rng() * 0.13;
    const shade = rng() > 0.55 ? 25 : 225;
    ctx.fillStyle = `rgba(${shade},${shade},${shade},${alpha})`;
    ctx.fillRect(x, y, 0.8 + rng() * 2.2, 0.7 + rng() * 1.8);
  }

  const grad = ctx.createLinearGradient(0, 0, 128, 0);
  grad.addColorStop(0, 'rgba(18,20,22,0.26)');
  grad.addColorStop(0.14, 'rgba(18,20,22,0.08)');
  grad.addColorStop(0.55, 'rgba(255,255,255,0)');
  grad.addColorStop(1, 'rgba(50,45,40,0.09)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 128, 256);

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

function appendQuadStrip(
  positions: number[],
  uvs: number[],
  indices: number[],
  rows: Array<Array<THREE.Vector3>>,
  uvRows: Array<Array<[number, number]>>,
): void {
  const base = positions.length / 3;
  const columns = rows[0].length;
  for (let r = 0; r < rows.length; r++) {
    for (let col = 0; col < columns; col++) {
      const p = rows[r][col];
      positions.push(p.x, p.y, p.z);
      const uv = uvRows[r][col];
      uvs.push(uv[0], uv[1]);
    }
  }
  for (let r = 0; r < rows.length - 1; r++) {
    for (let col = 0; col < columns - 1; col++) {
      const a = base + r * columns + col;
      const b = a + 1;
      const c = base + (r + 1) * columns + col;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }
}

export function buildRunoffShoulderGeometry(
  path: EdgeTrackPath,
  trackHalfWidthM: number,
  curbWidthM: number,
  outerRunoffM: number,
  segments = 640,
): THREE.BufferGeometry {
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const beyond = outerRunoffM - trackHalfWidthM - curbWidthM;
  const profile = [
    { d: 0, h: 0.010 },
    { d: curbWidthM, h: 0.012 },
    { d: curbWidthM + beyond * 0.22, h: -0.010 },
    { d: curbWidthM + beyond * 0.58, h: -0.105 },
    { d: curbWidthM + beyond, h: -0.35 },
  ];

  for (const side of [-1, 1] as const) {
    const rows: Array<Array<THREE.Vector3>> = [];
    const uvRows: Array<Array<[number, number]>> = [];
    for (let i = 0; i <= segments; i++) {
      const u = i / segments;
      const s = path.sampleAt(u);
      const row: THREE.Vector3[] = [];
      const uvRow: Array<[number, number]> = [];
      const profileIndices = side > 0
        ? profile.map((_, index) => index)
        : profile.map((_, index) => profile.length - 1 - index);
      for (const p of profileIndices) {
        const lateralM = side * (trackHalfWidthM + profile[p].d);
        row.push(
          s.center.clone()
            .addScaledVector(s.bankedLateral, lateralM)
            .addScaledVector(s.normal, profile[p].h),
        );
        uvRow.push([p / (profile.length - 1), (u * path.lengthM) / 12]);
      }
      rows.push(row);
      uvRows.push(uvRow);
    }
    appendQuadStrip(positions, uvs, indices, rows, uvRows);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

export function buildEdgeLineGeometry(
  path: EdgeTrackPath,
  trackHalfWidthM: number,
  segments = 720,
): THREE.BufferGeometry {
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  for (const side of [-1, 1] as const) {
    const rows: Array<Array<THREE.Vector3>> = [];
    const uvRows: Array<Array<[number, number]>> = [];
    for (let i = 0; i <= segments; i++) {
      const u = i / segments;
      const s = path.sampleAt(u);
      const outer = trackHalfWidthM - 0.025;
      const inner = outer - CURB_EDGE_LINE_WIDTH_M;
      const offsets = side > 0 ? [inner, outer] : [-outer, -inner];
      rows.push(offsets.map((offset) =>
        s.center.clone()
          .addScaledVector(s.bankedLateral, offset)
          .addScaledVector(s.normal, 0.033),
      ));
      uvRows.push([[0, (u * path.lengthM) / 8], [1, (u * path.lengthM) / 8]]);
    }
    appendQuadStrip(positions, uvs, indices, rows, uvRows);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

export function buildCurbRibbonGeometry(
  path: EdgeTrackPath,
  zones: readonly RealisticCurbZone[],
  trackHalfWidthM: number,
  curbWidthM: number,
): THREE.BufferGeometry {
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const roadVisualLift = 0.024;

  for (const zone of zones) {
    const segments = THREE.MathUtils.clamp(Math.ceil(zone.approxLengthM / 1.1), 18, 96);
    const rows: Array<Array<THREE.Vector3>> = [];
    const uvRows: Array<Array<[number, number]>> = [];

    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      const u = wrapU(zone.startU + zone.lengthU * t);
      const s = path.sampleAt(u);
      const row: THREE.Vector3[] = [];
      const uvRow: Array<[number, number]> = [];
      const profileIndices = zone.side > 0
        ? CURB_PROFILE_FRACTIONS.map((_, index) => index)
        : CURB_PROFILE_FRACTIONS.map((_, index) => CURB_PROFILE_FRACTIONS.length - 1 - index);
      for (const p of profileIndices) {
        const outward = curbWidthM * CURB_PROFILE_FRACTIONS[p];
        const lateralM = zone.side * (trackHalfWidthM + outward);
        row.push(
          s.center.clone()
            .addScaledVector(s.bankedLateral, lateralM)
            .addScaledVector(s.normal, roadVisualLift + CURB_VISUAL_PROFILE_M[p]),
        );
        uvRow.push([
          CURB_PROFILE_FRACTIONS[p],
          (t * zone.approxLengthM) / (CURB_STRIPE_LENGTH_M * 2),
        ]);
      }
      rows.push(row);
      uvRows.push(uvRow);
    }
    appendQuadStrip(positions, uvs, indices, rows, uvRows);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

export interface TrackEdgePresentationOptions {
  trackHalfWidthM: number;
  curbWidthM: number;
  outerRunoffM: number;
  runoffMaterial: THREE.Material;
}

export function buildTrackEdgePresentation(
  path: EdgeTrackPath,
  options: TrackEdgePresentationOptions,
): { group: THREE.Group; zones: RealisticCurbZone[] } {
  const group = new THREE.Group();
  group.name = 'showcase-realistic-track-edge';

  const shoulders = new THREE.Mesh(
    buildRunoffShoulderGeometry(path, options.trackHalfWidthM, options.curbWidthM, options.outerRunoffM),
    options.runoffMaterial,
  );
  shoulders.receiveShadow = true;
  group.add(shoulders);

  const lineMaterial = new THREE.MeshStandardMaterial({
    color: 0xe6e0d6,
    roughness: 0.86,
    metalness: 0,
  });
  const edgeLines = new THREE.Mesh(buildEdgeLineGeometry(path, options.trackHalfWidthM), lineMaterial);
  edgeLines.receiveShadow = true;
  group.add(edgeLines);

  const zones = deriveRealisticCurbZones(path);
  const curbTexture = makeWeatheredCurbTexture();
  const curbMaterial = new THREE.MeshStandardMaterial({
    map: curbTexture,
    roughness: 0.84,
    metalness: 0,
  });
  const curbs = new THREE.Mesh(
    buildCurbRibbonGeometry(path, zones, options.trackHalfWidthM, options.curbWidthM),
    curbMaterial,
  );
  curbs.receiveShadow = true;
  group.add(curbs);

  group.userData.curbZones = zones;
  return { group, zones };
}

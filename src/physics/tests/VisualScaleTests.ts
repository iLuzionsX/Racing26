import * as THREE from 'three';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { BMW_M5_2025_OVERRIDES } from '../m5G90';
import {
  horizontalFovForVertical,
  targetHorizontalFov,
  targetVerticalFov,
} from '../../graphics/cameraProjection';
import { fitM5VisualToRealScale } from '../../graphics/m5VisualScale';
import {
  BASE_VISUAL_WHEEL_RADIUS_M,
  BMW_M5_G90_LENGTH_M,
  MAIN_TEST_LANE_WIDTH_M,
} from '../../graphics/worldScale';

const assert = (condition: boolean, message: string) => {
  if (!condition) throw new Error(message);
};

const approx = (actual: number, expected: number, tolerance: number, message: string) => {
  assert(Math.abs(actual - expected) <= tolerance, `${message}: expected ${expected}, got ${actual}`);
};

class CompactBoundsReader {
  private offset = 0;
  constructor(private readonly bytes: Uint8Array) {}
  private take(length: number) {
    const result = this.bytes.subarray(this.offset, this.offset + length);
    assert(result.length === length, 'compact M5 test asset is truncated');
    this.offset += length;
    return result;
  }
  u8() { return this.take(1)[0]; }
  u16() { const b = this.take(2); return b[0] | (b[1] << 8); }
  i16() { const value = this.u16(); return value & 0x8000 ? value - 0x10000 : value; }
  u32() { const b = this.take(4); return (b[0] | (b[1] << 8) | (b[2] << 16) | (b[3] << 24)) >>> 0; }
  f32() { const b = this.take(4); return new DataView(b.buffer, b.byteOffset, 4).getFloat32(0, true); }
  string() { const length = this.u8(); return new TextDecoder().decode(this.take(length)); }
  skip(length: number) { this.take(length); }
}

function readBundledM5Bounds() {
  const assetDir = join(process.cwd(), 'public', 'assets', 'bmw-m5-g90-default');
  const encoded = Array.from({ length: 8 }, (_, index) =>
    readFileSync(join(assetDir, `part-${String(index).padStart(2, '0')}.b64`), 'utf8').trim()
  ).join('').replace(/\s+/g, '');
  const bytes = gunzipSync(Buffer.from(encoded, 'base64'));
  const reader = new CompactBoundsReader(bytes);
  const magic = String.fromCharCode(reader.u8(), reader.u8(), reader.u8(), reader.u8());
  assert(magic === 'M5C2', `unexpected bundled M5 magic: ${magic}`);
  const version = reader.u16();
  assert(version === 2, `unexpected bundled M5 version: ${version}`);
  const materialCount = reader.u16();
  const meshCount = reader.u16();
  for (let i = 0; i < materialCount; i += 1) {
    reader.string();
    reader.string();
    reader.i16();
  }

  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let meshIndex = 0; meshIndex < meshCount; meshIndex += 1) {
    reader.string();
    reader.i16();
    const vertexCount = reader.u16();
    const indexCount = reader.u32();
    const meshMinX = reader.f32(), meshMinY = reader.f32(), meshMinZ = reader.f32();
    const meshMaxX = reader.f32(), meshMaxY = reader.f32(), meshMaxZ = reader.f32();
    minX = Math.min(minX, meshMinX); minY = Math.min(minY, meshMinY); minZ = Math.min(minZ, meshMinZ);
    maxX = Math.max(maxX, meshMaxX); maxY = Math.max(maxY, meshMaxY); maxZ = Math.max(maxZ, meshMaxZ);
    reader.skip(vertexCount * 3 * 2);
    reader.skip(indexCount * 2);
  }

  return {
    widthM: maxX - minX,
    heightM: maxY - minY,
    lengthM: maxZ - minZ,
    meshCount,
  };
}

const aspect16x9 = 16 / 9;
const aspect21x9 = 21 / 9;
const speedKmh = 50;

// Legacy chase projection at 50 km/h was 66 deg V-FOV. On a normal widescreen
// monitor that is already ~98 deg H-FOV, and on ultrawide it exceeds 113 deg.
const legacyHorizontal16x9 = horizontalFovForVertical(66, aspect16x9);
const legacyHorizontal21x9 = horizontalFovForVertical(66, aspect21x9);
assert(legacyHorizontal16x9 > 98, `legacy 16:9 H-FOV unexpectedly small: ${legacyHorizontal16x9}`);
assert(legacyHorizontal21x9 > 113, `legacy 21:9 H-FOV unexpectedly small: ${legacyHorizontal21x9}`);

// New chase projection is authored as H-FOV and therefore keeps the same visual
// distance scale on every aspect ratio.
const targetHorizontal = targetHorizontalFov('chase', speedKmh);
approx(targetHorizontal, 82, 1e-9, '50 km/h chase H-FOV');
const vertical16x9 = targetVerticalFov('chase', speedKmh, aspect16x9);
const vertical21x9 = targetVerticalFov('chase', speedKmh, aspect21x9);
approx(horizontalFovForVertical(vertical16x9, aspect16x9), targetHorizontal, 1e-9, '16:9 projection round-trip');
approx(horizontalFovForVertical(vertical21x9, aspect21x9), targetHorizontal, 1e-9, '21:9 projection round-trip');
assert(vertical16x9 < 53 && vertical16x9 > 51, `16:9 vertical FOV should be ~52 deg, got ${vertical16x9}`);

// The M5 physical wheel radius is 0.369 m; the procedural mesh was authored at
// 0.33 m. Runtime scaling must therefore enlarge it by ~11.8%, not leave it small.
const physicalWheelRadius = BMW_M5_2025_OVERRIDES.wheelRadius as number;
const wheelVisualScale = physicalWheelRadius / BASE_VISUAL_WHEEL_RADIUS_M;
approx(wheelVisualScale, 1.1181818181818182, 1e-9, 'M5 wheel visual scale');

// The visible central test lane must match the surface provider's |x| <= 6.5 m zone.
approx(MAIN_TEST_LANE_WIDTH_M, 13, 1e-9, 'main test lane width');

// A 20-23 m radius is not hundreds of metres: its diameter is ~7.85-9.03 G90
// body lengths. This gives a stable visual sanity check independent of camera.
const minDiameterCarLengths = (20 * 2) / BMW_M5_G90_LENGTH_M;
const maxDiameterCarLengths = (23 * 2) / BMW_M5_G90_LENGTH_M;
assert(minDiameterCarLengths > 7.8 && minDiameterCarLengths < 7.9, `20 m radius scale ratio invalid: ${minDiameterCarLengths}`);
assert(maxDiameterCarLengths > 9.0 && maxDiameterCarLengths < 9.1, `23 m radius scale ratio invalid: ${maxDiameterCarLengths}`);

// Measure the real bundled asset bytes, then pass those measured dimensions through
// the same body-scale guard used at runtime. The compact G90 is already within 7 mm
// of the 5.096 m reference, so the guard should verify it without a needless rescale.
const bundledBounds = readBundledM5Bounds();
assert(bundledBounds.lengthM > 3.5 && bundledBounds.lengthM < 7, `bundled M5 length is implausible: ${bundledBounds.lengthM}`);
assert(bundledBounds.widthM > 1.5 && bundledBounds.widthM < 3, `bundled M5 width is implausible: ${bundledBounds.widthM}`);
const measuredM5 = new THREE.Group();
measuredM5.add(new THREE.Mesh(
  new THREE.BoxGeometry(bundledBounds.widthM, bundledBounds.heightM, bundledBounds.lengthM),
  new THREE.MeshBasicMaterial()
));
const scaleReport = fitM5VisualToRealScale(measuredM5);
const bodyLengthErrorM = Math.abs(scaleReport.finalLengthM - BMW_M5_G90_LENGTH_M);
const bodyLengthErrorPercent = (bodyLengthErrorM / BMW_M5_G90_LENGTH_M) * 100;
assert(bodyLengthErrorM <= 0.01, `bundled M5 body-scale error exceeds 10 mm: ${bodyLengthErrorM} m`);
approx(scaleReport.appliedScale, 1, 1e-12, 'already-correct bundled M5 should not be rescaled');

console.log(JSON.stringify({
  speedKmh,
  camera: {
    legacyHorizontal16x9Deg: legacyHorizontal16x9,
    legacyHorizontal21x9Deg: legacyHorizontal21x9,
    correctedHorizontalDeg: targetHorizontal,
    correctedVertical16x9Deg: vertical16x9,
    correctedVertical21x9Deg: vertical21x9,
  },
  worldScale: {
    physicalWheelRadiusM: physicalWheelRadius,
    authoredWheelRadiusM: BASE_VISUAL_WHEEL_RADIUS_M,
    wheelVisualScale,
    mainTestLaneWidthM: MAIN_TEST_LANE_WIDTH_M,
    turnDiameterCarLengths: [minDiameterCarLengths, maxDiameterCarLengths],
    bundledM5SourceBoundsM: bundledBounds,
    bundledM5AppliedScale: scaleReport.appliedScale,
    bundledM5BodyLengthErrorM: bodyLengthErrorM,
    bundledM5BodyLengthErrorPercent: bodyLengthErrorPercent,
    verifiedBodyLengthM: scaleReport.finalLengthM,
  },
  status: 'passed',
}, null, 2));

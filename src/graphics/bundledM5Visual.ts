import * as THREE from 'three';
import type { VehicleConfig } from '../types';
import type { Kn5VisualResult } from './kn5Loader';
import { fitM5VisualToRealScale } from './m5VisualScale';

const DEFAULT_M5_ASSET_PARTS = 8;
const DEFAULT_M5_ASSET_DIR = `${import.meta.env.BASE_URL}assets/bmw-m5-g90-default`;
const TEXT_DECODER = new TextDecoder('utf-8');

interface CompactMaterialRecord { name: string; shader: string; blendMode: number; }

class BinaryReader {
  private offset = 0;
  constructor(private readonly bytes: Uint8Array) {}
  private take(length: number): Uint8Array {
    if (length < 0 || this.offset + length > this.bytes.length) throw new Error('Compact BMW visual is truncated.');
    const result = this.bytes.subarray(this.offset, this.offset + length); this.offset += length; return result;
  }
  u8(): number { return this.take(1)[0]; }
  u16(): number { const b = this.take(2); return b[0] | (b[1] << 8); }
  i16(): number { const value = this.u16(); return value & 0x8000 ? value - 0x10000 : value; }
  u32(): number { const b = this.take(4); return (b[0] | (b[1] << 8) | (b[2] << 16) | (b[3] << 24)) >>> 0; }
  f32(): number { const b = this.take(4); return new DataView(b.buffer, b.byteOffset, 4).getFloat32(0, true); }
  string(): string { return TEXT_DECODER.decode(this.take(this.u8())); }
  remaining(): number { return this.bytes.length - this.offset; }
}

async function loadBundledBytes(): Promise<Uint8Array> {
  const parts = await Promise.all(Array.from({ length: DEFAULT_M5_ASSET_PARTS }, async (_, index) => {
    const part = String(index).padStart(2, '0');
    const response = await fetch(`${DEFAULT_M5_ASSET_DIR}/part-${part}.b64`);
    if (!response.ok) throw new Error(`Default BMW asset part ${part} failed to load (${response.status}).`);
    return (await response.text()).trim();
  }));
  const binary = atob(parts.join('').replace(/\s+/g, ''));
  const compressed = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) compressed[i] = binary.charCodeAt(i);
  const Decompression = (globalThis as any).DecompressionStream;
  if (!Decompression) throw new Error('This browser does not support gzip decompression for the bundled BMW visual.');
  const stream = new Blob([compressed.slice().buffer]).stream().pipeThrough(new Decompression('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function materialFor(record: CompactMaterialRecord): THREE.MeshStandardMaterial {
  const name = record.name.toLowerCase();
  const material = new THREE.MeshStandardMaterial({ name: record.name, color: 0x20252c, roughness: 0.46, metalness: 0.18 });
  if (name === 'carpaint') {
    material.color.set(0x315f8f); material.metalness = 0.58; material.roughness = 0.24; material.envMapIntensity = 1.35;
  } else if (name === 'window') {
    material.color.set(0x08111d); material.metalness = 0.08; material.roughness = 0.12;
    material.transparent = false; material.opacity = 1; material.depthWrite = true; material.side = THREE.DoubleSide;
  } else if (name === 'glass_red') {
    material.color.set(0x8b0b16); material.emissive.set(0x310208); material.emissiveIntensity = 0.55; material.metalness = 0.02; material.roughness = 0.18; material.transparent = true; material.opacity = 0.82; material.depthWrite = false;
  } else if (name.includes('light')) {
    material.color.set(0xdbeafe); material.emissive.set(0xb9d9ff); material.emissiveIntensity = 0.55; material.metalness = 0.16; material.roughness = 0.15;
  } else if (name.includes('chrome') || name.includes('badge')) {
    material.color.set(0xcbd5e1); material.metalness = 0.92; material.roughness = 0.12;
  } else if (name.includes('grille') || name.includes('black') || name.includes('carbon') || name === 'roof' || name === 'wiper') {
    material.color.set(name.includes('carbon') ? 0x111318 : 0x090b0f); material.metalness = name.includes('gloss') ? 0.42 : 0.24; material.roughness = name.includes('gloss') ? 0.2 : 0.42;
  } else if (name.includes('plate')) {
    material.color.set(0xe5e7eb); material.metalness = 0.05; material.roughness = 0.55;
  } else if (name.includes('mirror')) {
    material.color.set(0x161a20); material.metalness = 0.55; material.roughness = 0.22;
  }
  if (record.blendMode !== 0 && !material.transparent && name !== 'window') { material.transparent = true; material.opacity = 0.88; material.depthWrite = false; }
  return material;
}

function parseCompactM5(bytes: Uint8Array): Kn5VisualResult {
  const reader = new BinaryReader(bytes);
  const magic = TEXT_DECODER.decode(new Uint8Array([reader.u8(), reader.u8(), reader.u8(), reader.u8()]));
  if (magic !== 'M5C2') throw new Error(`Unsupported bundled BMW format: ${magic}`);
  const version = reader.u16(); if (version !== 2) throw new Error(`Unsupported bundled BMW version: ${version}`);
  const materialCount = reader.u16(); const meshCount = reader.u16(); const materialRecords: CompactMaterialRecord[] = [];
  for (let i = 0; i < materialCount; i += 1) materialRecords.push({ name: reader.string(), shader: reader.string(), blendMode: reader.i16() });
  const materials = materialRecords.map(materialFor);
  const fallback = new THREE.MeshStandardMaterial({ color: 0x20252c, roughness: 0.46, metalness: 0.18 });
  const group = new THREE.Group(); group.name = 'bmw_m5_2024_default_runtime';
  for (let meshIndex = 0; meshIndex < meshCount; meshIndex += 1) {
    const name = reader.string(); const materialId = reader.i16(); const vertexCount = reader.u16(); const indexCount = reader.u32();
    const minX = reader.f32(), minY = reader.f32(), minZ = reader.f32(), maxX = reader.f32(), maxY = reader.f32(), maxZ = reader.f32();
    const sizeX = maxX - minX, sizeY = maxY - minY, sizeZ = maxZ - minZ;
    const positions = new Float32Array(vertexCount * 3);
    for (let v = 0; v < vertexCount; v += 1) {
      positions[v * 3] = minX + (reader.u16() / 65535) * sizeX;
      positions[v * 3 + 1] = minY + (reader.u16() / 65535) * sizeY;
      positions[v * 3 + 2] = minZ + (reader.u16() / 65535) * sizeZ;
    }
    const indices = new Uint16Array(indexCount); for (let i = 0; i < indexCount; i += 1) indices[i] = reader.u16();
    for (let i = 0; i + 2 < indexCount; i += 3) { const temp = indices[i + 1]; indices[i + 1] = indices[i + 2]; indices[i + 2] = temp; }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3)); geometry.setIndex(new THREE.BufferAttribute(indices, 1));
    geometry.computeVertexNormals(); geometry.computeBoundingBox(); geometry.computeBoundingSphere();
    const mesh = new THREE.Mesh(geometry, materials[materialId] ?? fallback); mesh.name = name; mesh.castShadow = true; mesh.receiveShadow = true; group.add(mesh);
  }
  if (reader.remaining() !== 0) throw new Error(`Bundled BMW visual has ${reader.remaining()} unexpected trailing bytes.`);

  const scaleReport = fitM5VisualToRealScale(group);
  const scaleMessage = Math.abs(scaleReport.appliedScale - 1) > 0.0025
    ? `Bundled BMW visual normalized from ${scaleReport.sourceLengthM.toFixed(3)} m to ${scaleReport.finalLengthM.toFixed(3)} m (x${scaleReport.appliedScale.toFixed(4)}).`
    : `Bundled BMW visual metre scale verified at ${scaleReport.finalLengthM.toFixed(3)} m long.`;

  return {
    group,
    version,
    meshCount,
    textureCount: 0,
    materialCount,
    hiddenWheelNodeCount: 4,
    warnings: [
      'Default BMW uses compact LOD-C exterior geometry from the supplied G90 mod. Physics-driven wheel/suspension assemblies remain separate; importing the original KN5 replaces this with the full-detail textured car.',
      scaleMessage,
    ],
  };
}

export async function loadBundledM5Visual(_config: VehicleConfig): Promise<Kn5VisualResult> { return parseCompactM5(await loadBundledBytes()); }

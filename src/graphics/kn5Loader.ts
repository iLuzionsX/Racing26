import * as THREE from 'three';
import { DDSLoader } from 'three/examples/jsm/loaders/DDSLoader.js';

/**
 * Assetto Corsa KN5 browser loader.
 *
 * KN5 is not a documented web format. The binary layout used here is based on
 * public reverse-engineering references, including RFloEng/AC_to_SVJ's MIT
 * licensed kn5_reader.py and RaduMC/kn5-converter. This implementation is a
 * clean TypeScript browser parser tailored to Physics Drive Lab.
 */

export interface PrimaryKn5Source {
  name: string;
  data: Uint8Array;
}

export interface PrimaryKn5Extraction {
  source: PrimaryKn5Source | null;
  warning?: string;
}

export interface Kn5VisualResult {
  group: THREE.Group;
  version: number;
  meshCount: number;
  textureCount: number;
  materialCount: number;
  hiddenWheelNodeCount: number;
  warnings: string[];
}

interface ZipEntry {
  path: string;
  flags: number;
  method: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
}

interface Kn5TextureRecord {
  name: string;
  data: Uint8Array;
}

interface Kn5MaterialRecord {
  name: string;
  shader: string;
  blendMode: number;
  ksDiffuse: number;
  ksSpecular: number;
  diffuseMult: number;
  txDiffuse?: string;
  txNormal?: string;
}

interface Kn5NodeRecord {
  type: number;
  name: string;
  active: boolean;
  renderable: boolean;
  visible: boolean;
  matrix?: number[];
  positions?: Float32Array;
  normals?: Float32Array;
  uvs?: Float32Array;
  indices?: Uint16Array;
  materialId: number;
  children: Kn5NodeRecord[];
}

interface ParsedKn5 {
  version: number;
  textures: Kn5TextureRecord[];
  materials: Kn5MaterialRecord[];
  root: Kn5NodeRecord;
}

const TEXT_DECODER = new TextDecoder('utf-8');

export async function extractPrimaryKn5FromFiles(inputFiles: File[] | FileList): Promise<PrimaryKn5Extraction> {
  const files = Array.from(inputFiles as ArrayLike<File>);
  if (files.length === 0) return { source: null };

  if (files.length === 1 && files[0].name.toLowerCase().endsWith('.zip')) {
    return extractPrimaryKn5FromZip(files[0]);
  }

  const candidates = files
    .filter((file) => file.name.toLowerCase().endsWith('.kn5'))
    .sort((a, b) => scoreKn5Name(getRelativePath(b)) - scoreKn5Name(getRelativePath(a)));

  if (candidates.length === 0) return { source: null, warning: 'No KN5 visual model was found in the selected folder.' };
  const chosen = candidates[0];
  try {
    return {
      source: {
        name: getRelativePath(chosen),
        data: new Uint8Array(await chosen.arrayBuffer()),
      },
    };
  } catch {
    return { source: null, warning: `Could not read ${chosen.name}. Physics import can still be used.` };
  }
}

export async function loadKn5Visual(source: PrimaryKn5Source): Promise<Kn5VisualResult> {
  const parsed = parseKn5(source.data);
  const warnings: string[] = [];
  const textureMap = await buildTextureMap(parsed.textures, warnings);
  const materials = buildMaterials(parsed.materials, textureMap);
  let meshCount = 0;
  let hiddenWheelNodeCount = 0;

  const fallbackMaterial = new THREE.MeshStandardMaterial({
    color: 0x64748b,
    roughness: 0.48,
    metalness: 0.18,
    side: THREE.DoubleSide,
  });

  const buildNode = (node: Kn5NodeRecord, wheelAncestor = false): THREE.Object3D => {
    const object = new THREE.Group();
    object.name = node.name;

    if (node.matrix) {
      object.matrixAutoUpdate = false;
      object.matrix.copy(kn5RowMatrixToThree(node.matrix));
    }

    const hideForWheel = wheelAncestor || isWheelVisualNode(node.name);
    const hideForRuntimeState = isEphemeralVisual(node.name);
    if (hideForWheel) hiddenWheelNodeCount += 1;
    // The three bytes after a KN5 mesh header are not general runtime visibility
    // bits. The real G90 has the third byte cleared on most body meshes and set on
    // much of its glass, so treating it as `visible` removes the body. Only the
    // documented node `active` byte controls ordinary scene visibility here;
    // wheel replacement and transient damage/blur meshes are handled explicitly.
    object.visible = node.active && !hideForWheel && !hideForRuntimeState;

    if (node.positions && node.indices && node.positions.length > 0 && node.indices.length > 0) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(node.positions, 3));
      if (node.normals && node.normals.length === node.positions.length) {
        geometry.setAttribute('normal', new THREE.BufferAttribute(node.normals, 3));
      } else {
        geometry.computeVertexNormals();
      }
      if (node.uvs) geometry.setAttribute('uv', new THREE.BufferAttribute(node.uvs, 2));
      geometry.setIndex(new THREE.BufferAttribute(node.indices, 1));
      geometry.computeBoundingSphere();

      const material = materials[node.materialId] ?? fallbackMaterial;
      const mesh = new THREE.Mesh(geometry, material);
      mesh.name = `${node.name}_mesh`;
      mesh.castShadow = node.renderable;
      mesh.receiveShadow = true;
      object.add(mesh);
      meshCount += 1;
    }

    for (const child of node.children) object.add(buildNode(child, hideForWheel));
    return object;
  };

  const root = new THREE.Group();
  root.name = source.name.replace(/\.kn5$/i, '');
  root.add(buildNode(parsed.root));
  root.updateMatrixWorld(true);

  if (hiddenWheelNodeCount === 0) {
    warnings.push('No standard AC wheel-node names were recognized. The imported body may still contain static wheel geometry; the simulator’s physics-driven wheels remain enabled.');
  }

  if (textureMap.size === 0 && parsed.textures.length > 0) {
    warnings.push('KN5 geometry loaded, but none of its embedded textures could be decoded in this browser. Materials are using AC shader values with neutral fallback color.');
  }

  return {
    group: root,
    version: parsed.version,
    meshCount,
    textureCount: textureMap.size,
    materialCount: materials.length,
    hiddenWheelNodeCount,
    warnings,
  };
}

async function extractPrimaryKn5FromZip(file: File): Promise<PrimaryKn5Extraction> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocd = findEocd(view);
  if (eocd < 0) return { source: null, warning: 'Could not scan the ZIP for a KN5 model.' };

  const entryCount = view.getUint16(eocd + 10, true);
  let cursor = view.getUint32(eocd + 16, true);
  const entries: ZipEntry[] = [];

  for (let i = 0; i < entryCount; i += 1) {
    if (cursor + 46 > view.byteLength || view.getUint32(cursor, true) !== 0x02014b50) break;
    const flags = view.getUint16(cursor + 8, true);
    const method = view.getUint16(cursor + 10, true);
    const compressedSize = view.getUint32(cursor + 20, true);
    const uncompressedSize = view.getUint32(cursor + 24, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    const localHeaderOffset = view.getUint32(cursor + 42, true);
    const path = normalizePath(TEXT_DECODER.decode(bytes.subarray(cursor + 46, cursor + 46 + nameLength)));

    if (path.toLowerCase().endsWith('.kn5') && !path.endsWith('/')) {
      entries.push({ path, flags, method, compressedSize, uncompressedSize, localHeaderOffset });
    }

    cursor += 46 + nameLength + extraLength + commentLength;
  }

  if (entries.length === 0) return { source: null, warning: 'No KN5 visual model was found in this ZIP.' };
  const chosen = entries.sort((a, b) => {
    const scoreDelta = scoreKn5Name(b.path) - scoreKn5Name(a.path);
    if (scoreDelta !== 0) return scoreDelta;
    return b.uncompressedSize - a.uncompressedSize;
  })[0];

  if ((chosen.flags & 0x1) !== 0) {
    return { source: null, warning: `${chosen.path} is encrypted/protected, so the browser importer left the visual asset untouched.` };
  }

  try {
    const data = await extractZipEntry(bytes, view, chosen);
    return { source: { name: chosen.path, data } };
  } catch (error) {
    return { source: null, warning: error instanceof Error ? error.message : `Could not extract ${chosen.path}.` };
  }
}

function parseKn5(data: Uint8Array): ParsedKn5 {
  const reader = new BinaryReader(data);
  const magic = reader.readString(6);
  if (magic !== 'sc6969') throw new Error(`The selected KN5 has an invalid magic header (${JSON.stringify(magic)}).`);

  const version = reader.readI32();
  if (![1, 2, 4, 5, 6].includes(version)) {
    throw new Error(`KN5 version ${version} is not supported yet. Known browser-loader versions are 1, 2, 4, 5 and 6.`);
  }
  if (version > 5) reader.skip(4);

  const textures: Kn5TextureRecord[] = [];
  const textureCount = reader.readSafeCount('texture');
  for (let i = 0; i < textureCount; i += 1) {
    const textureType = reader.readI32();
    const name = reader.readLengthString();
    if (textureType === 0) {
      textures.push({ name, data: new Uint8Array() });
    } else {
      const size = reader.readI32();
      if (size < 0 || size > reader.remaining) throw new Error(`KN5 texture ${name} has an invalid byte length.`);
      textures.push({ name, data: reader.readBytes(size) });
    }
  }

  const materials: Kn5MaterialRecord[] = [];
  const materialCount = reader.readSafeCount('material');
  for (let i = 0; i < materialCount; i += 1) {
    const material: Kn5MaterialRecord = {
      name: reader.readLengthString(),
      shader: reader.readLengthString(),
      blendMode: reader.readI16(),
      ksDiffuse: 0.6,
      ksSpecular: 0.9,
      diffuseMult: 1,
    };
    if (version > 4) reader.skip(4);

    const propCount = reader.readSafeCount('material property');
    for (let p = 0; p < propCount; p += 1) {
      const propName = reader.readLengthString();
      const propValue = reader.readF32();
      reader.skip(36);
      if (propName === 'ksDiffuse') material.ksDiffuse = propValue;
      else if (propName === 'ksSpecular') material.ksSpecular = propValue;
      else if (propName === 'diffuseMult') material.diffuseMult = propValue;
    }

    const textureSlotCount = reader.readSafeCount('material texture slot');
    for (let t = 0; t < textureSlotCount; t += 1) {
      const sampleName = reader.readLengthString();
      reader.readI32();
      const textureName = reader.readLengthString();
      if (sampleName === 'txDiffuse') material.txDiffuse = textureName;
      else if (sampleName === 'txNormal') material.txNormal = textureName;
    }
    materials.push(material);
  }

  return { version, textures, materials, root: readKn5Node(reader) };
}

function readKn5Node(reader: BinaryReader): Kn5NodeRecord {
  const type = reader.readI32();
  const name = reader.readLengthString();
  const childCount = reader.readSafeCount(`children for ${name}`);
  const active = reader.readU8() !== 0;

  const node: Kn5NodeRecord = {
    type,
    name,
    active,
    renderable: true,
    visible: true,
    materialId: -1,
    children: [],
  };

  if (type === 1) {
    node.matrix = Array.from({ length: 16 }, () => reader.readF32());
  } else if (type === 2) {
    const flags = [reader.readU8(), reader.readU8(), reader.readU8()];
    node.renderable = flags[0] !== 0;
    node.visible = flags[2] !== 0;
    const vertexCount = reader.readSafeCount(`vertices for ${name}`, 5_000_000);
    const positions = new Float32Array(vertexCount * 3);
    const normals = new Float32Array(vertexCount * 3);
    const uvs = new Float32Array(vertexCount * 2);

    for (let v = 0; v < vertexCount; v += 1) {
      const p = v * 3;
      const uv = v * 2;
      positions[p] = reader.readF32();
      positions[p + 1] = reader.readF32();
      positions[p + 2] = reader.readF32();
      normals[p] = reader.readF32();
      normals[p + 1] = reader.readF32();
      normals[p + 2] = reader.readF32();
      uvs[uv] = reader.readF32();
      uvs[uv + 1] = reader.readF32();
      reader.skip(12);
    }

    const indexCount = reader.readSafeCount(`indices for ${name}`, 15_000_000);
    const indices = new Uint16Array(indexCount);
    for (let i = 0; i < indexCount; i += 1) indices[i] = reader.readU16();
    node.materialId = reader.readI32();
    reader.skip(29);
    node.positions = positions;
    node.normals = normals;
    node.uvs = uvs;
    node.indices = indices;
  } else if (type === 3) {
    const flags = [reader.readU8(), reader.readU8(), reader.readU8()];
    node.renderable = flags[0] !== 0;
    node.visible = flags[2] !== 0;
    const boneCount = reader.readSafeCount(`bones for ${name}`, 100_000);
    for (let b = 0; b < boneCount; b += 1) {
      reader.readLengthString();
      reader.skip(64);
    }

    const vertexCount = reader.readSafeCount(`vertices for ${name}`, 5_000_000);
    const positions = new Float32Array(vertexCount * 3);
    const normals = new Float32Array(vertexCount * 3);
    const uvs = new Float32Array(vertexCount * 2);
    for (let v = 0; v < vertexCount; v += 1) {
      const p = v * 3;
      const uv = v * 2;
      positions[p] = reader.readF32();
      positions[p + 1] = reader.readF32();
      positions[p + 2] = reader.readF32();
      normals[p] = reader.readF32();
      normals[p + 1] = reader.readF32();
      normals[p + 2] = reader.readF32();
      uvs[uv] = reader.readF32();
      uvs[uv + 1] = reader.readF32();
      reader.skip(44);
    }

    const indexCount = reader.readSafeCount(`indices for ${name}`, 15_000_000);
    const indices = new Uint16Array(indexCount);
    for (let i = 0; i < indexCount; i += 1) indices[i] = reader.readU16();
    node.materialId = reader.readI32();
    reader.skip(12);
    node.positions = positions;
    node.normals = normals;
    node.uvs = uvs;
    node.indices = indices;
  } else {
    throw new Error(`Unknown KN5 node type ${type} at ${name}. This may be a newer or protected KN5.`);
  }

  for (let i = 0; i < childCount; i += 1) node.children.push(readKn5Node(reader));
  return node;
}

async function buildTextureMap(textures: Kn5TextureRecord[], warnings: string[]): Promise<Map<string, THREE.Texture>> {
  const map = new Map<string, THREE.Texture>();
  const ddsLoader = new DDSLoader();
  const imageLoader = new THREE.TextureLoader();

  for (const texture of textures) {
    if (!texture.data.length) continue;
    const lower = texture.name.toLowerCase();
    const isDds = lower.endsWith('.dds') || hasAsciiPrefix(texture.data, 'DDS ');
    const isPng = lower.endsWith('.png') || hasBytes(texture.data, [0x89, 0x50, 0x4e, 0x47]);
    const isJpeg = lower.endsWith('.jpg') || lower.endsWith('.jpeg') || hasBytes(texture.data, [0xff, 0xd8, 0xff]);
    if (!isDds && !isPng && !isJpeg) continue;

    const blob = new Blob([texture.data.slice().buffer], {
      type: isDds ? 'image/vnd-ms.dds' : isPng ? 'image/png' : 'image/jpeg',
    });
    const url = URL.createObjectURL(blob);
    try {
      const loaded = isDds ? await ddsLoader.loadAsync(url) : await imageLoader.loadAsync(url);
      loaded.name = texture.name;
      loaded.flipY = false;
      loaded.wrapS = THREE.RepeatWrapping;
      loaded.wrapT = THREE.RepeatWrapping;
      map.set(texture.name.toLowerCase(), loaded);
    } catch {
      warnings.push(`Texture ${texture.name} could not be decoded; its material will use a fallback color.`);
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  return map;
}

function buildMaterials(records: Kn5MaterialRecord[], textures: Map<string, THREE.Texture>): THREE.Material[] {
  return records.map((record) => {
    const base = Math.max(0.05, Math.min(1, record.ksDiffuse * record.diffuseMult));
    const diffuse = record.txDiffuse ? textures.get(record.txDiffuse.toLowerCase()) : undefined;
    const normal = record.txNormal ? textures.get(record.txNormal.toLowerCase()) : undefined;
    if (diffuse) diffuse.colorSpace = THREE.SRGBColorSpace;

    const material = new THREE.MeshStandardMaterial({
      name: record.name,
      color: diffuse ? 0xffffff : new THREE.Color(base, base, base),
      map: diffuse ?? null,
      normalMap: normal ?? null,
      roughness: Math.max(0.12, Math.min(0.95, 1 - record.ksSpecular * 0.72)),
      metalness: shaderLooksMetallic(record.shader) ? 0.65 : 0.08,
      transparent: record.blendMode === 1,
      opacity: 1,
      alphaTest: record.blendMode === 256 ? 0.45 : 0,
      depthWrite: record.blendMode !== 1,
      side: THREE.DoubleSide,
    });
    return material;
  });
}

function shaderLooksMetallic(shader: string): boolean {
  const lower = shader.toLowerCase();
  return lower.includes('carpaint') || lower.includes('metal') || lower.includes('chrome');
}

function kn5RowMatrixToThree(m: number[]): THREE.Matrix4 {
  // KN5 stores a row-vector matrix with translation in row 4. Transpose it for
  // Three.js' column-vector convention while keeping Physics Drive Lab's +Z-forward
  // visual convention. Double-sided materials handle KN5's opposite winding.
  return new THREE.Matrix4().set(
    m[0], m[4], m[8], m[12],
    m[1], m[5], m[9], m[13],
    m[2], m[6], m[10], m[14],
    m[3], m[7], m[11], m[15],
  );
}

function isWheelVisualNode(name: string): boolean {
  const n = name.toUpperCase().replace(/\s+/g, '_');
  if (/^(WHEEL|HUB|UPRIGHT|SUSP)_(LF|RF|LR|RR|FL|FR|RL)$/.test(n)) return true;
  return /(^|_)(WHEEL|RIM|TYRE|TIRE|HUB|DISC|CALIPER|UPRIGHT|SUSP)[_-]?(LF|RF|LR|RR|FL|FR|RL)(_|$)/.test(n);
}

function isEphemeralVisual(name: string): boolean {
  const n = name.toLowerCase();
  return ['blur', 'damage', 'dent', 'bent', 'crash', 'deform'].some((token) => n.includes(token));
}

function scoreKn5Name(path: string): number {
  const lower = normalizePath(path).toLowerCase();
  const base = lower.split('/').pop() || lower;
  let score = 0;
  if (!base.includes('collider')) score += 200;
  if (!base.includes('lod')) score += 120;
  if (!base.includes('driver')) score += 50;
  if (!base.includes('animation')) score += 25;
  score -= (lower.split('/').length - 1) * 2;
  return score;
}

function getRelativePath(file: File): string {
  return normalizePath((file as any).webkitRelativePath || file.name);
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+/g, '/');
}

function findEocd(view: DataView): number {
  const min = Math.max(0, view.byteLength - 22 - 0xffff);
  for (let i = view.byteLength - 22; i >= min; i -= 1) {
    if (view.getUint32(i, true) === 0x06054b50) return i;
  }
  return -1;
}

async function extractZipEntry(bytes: Uint8Array, view: DataView, entry: ZipEntry): Promise<Uint8Array> {
  const offset = entry.localHeaderOffset;
  if (offset + 30 > view.byteLength || view.getUint32(offset, true) !== 0x04034b50) {
    throw new Error(`The ZIP header for ${entry.path} is malformed.`);
  }
  const nameLength = view.getUint16(offset + 26, true);
  const extraLength = view.getUint16(offset + 28, true);
  const start = offset + 30 + nameLength + extraLength;
  const compressed = bytes.subarray(start, start + entry.compressedSize);
  if (entry.method === 0) return compressed.slice();
  if (entry.method !== 8) throw new Error(`The KN5 uses unsupported ZIP compression method ${entry.method}. Extract the car folder and import that instead.`);

  const Ctor = (globalThis as any).DecompressionStream;
  if (!Ctor) throw new Error('This browser cannot decompress the KN5 from ZIP. Extract the car folder first, then import the folder.');
  const stream = new Blob([compressed.slice().buffer]).stream().pipeThrough(new Ctor('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function hasAsciiPrefix(bytes: Uint8Array, prefix: string): boolean {
  if (bytes.length < prefix.length) return false;
  for (let i = 0; i < prefix.length; i += 1) if (bytes[i] !== prefix.charCodeAt(i)) return false;
  return true;
}

function hasBytes(bytes: Uint8Array, prefix: number[]): boolean {
  if (bytes.length < prefix.length) return false;
  return prefix.every((value, index) => bytes[index] === value);
}

class BinaryReader {
  private view: DataView;
  private bytes: Uint8Array;
  public offset = 0;

  constructor(data: Uint8Array) {
    this.bytes = data;
    this.view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  }

  get remaining(): number {
    return this.view.byteLength - this.offset;
  }

  readU8(): number {
    this.ensure(1);
    const value = this.view.getUint8(this.offset);
    this.offset += 1;
    return value;
  }

  readI16(): number {
    this.ensure(2);
    const value = this.view.getInt16(this.offset, true);
    this.offset += 2;
    return value;
  }

  readU16(): number {
    this.ensure(2);
    const value = this.view.getUint16(this.offset, true);
    this.offset += 2;
    return value;
  }

  readI32(): number {
    this.ensure(4);
    const value = this.view.getInt32(this.offset, true);
    this.offset += 4;
    return value;
  }

  readF32(): number {
    this.ensure(4);
    const value = this.view.getFloat32(this.offset, true);
    this.offset += 4;
    return value;
  }

  readSafeCount(label: string, max = 1_000_000): number {
    const value = this.readI32();
    if (!Number.isInteger(value) || value < 0 || value > max) {
      throw new Error(`KN5 ${label} count ${value} is invalid or unsupported.`);
    }
    return value;
  }

  readString(length: number): string {
    if (length < 0) throw new Error('KN5 contains a negative string length.');
    this.ensure(length);
    const value = TEXT_DECODER.decode(this.bytes.subarray(this.offset, this.offset + length));
    this.offset += length;
    return value;
  }

  readLengthString(): string {
    const length = this.readI32();
    if (length < 0 || length > 16_000_000) throw new Error(`KN5 string length ${length} is invalid.`);
    return this.readString(length);
  }

  readBytes(length: number): Uint8Array {
    this.ensure(length);
    const value = this.bytes.slice(this.offset, this.offset + length);
    this.offset += length;
    return value;
  }

  skip(length: number) {
    this.ensure(length);
    this.offset += length;
  }

  private ensure(length: number) {
    if (length < 0 || this.offset + length > this.view.byteLength) {
      throw new Error(`Unexpected end of KN5 data at byte ${this.offset}. The model may be protected or use an unsupported format variant.`);
    }
  }
}

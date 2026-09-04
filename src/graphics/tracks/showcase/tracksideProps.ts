import * as THREE from 'three';
import { finalizeStaticMesh } from './trackPerformance';
import { fictionalBrandForSector, getFictionalBrand, makeFictionalBannerMaterial, makeFictionalInfoTexture, makeFictionalNumberTexture } from './fictionalBranding';

/** Minimal track frame; compatible with ShowcaseTrackPath.sampleAt without importing locked module. */
export interface TrackFrame {
  center: THREE.Vector3;
  tangent: THREE.Vector3;
  lateral: THREE.Vector3;
  bankedLateral: THREE.Vector3;
  normal: THREE.Vector3;
}
export interface TrackPathLike {
  sampleAt(u: number): TrackFrame;
}
export interface TracksideContext {
  path: TrackPathLike;
  barrierOffsetM: number;
}
export interface SidePlacement {
  u: number;
  side?: -1 | 1;
  extraClearanceM?: number;
}

export function wrapU(u: number): number {
  return ((u % 1) + 1) % 1;
}

/** Enforce placement outside full 18m recovery runoff + barrier corridor. */
export function resolveOutsideRunoff(requestedLateralM: number, ctx: TracksideContext, extraM = 1.0): number {
  const minAbs = ctx.barrierOffsetM + Math.max(0, extraM);
  const sign = requestedLateralM === 0 ? 1 : Math.sign(requestedLateralM);
  if (Math.abs(requestedLateralM) < minAbs) return sign * minAbs;
  return requestedLateralM;
}

function frameQuaternion(frame: TrackFrame): THREE.Quaternion {
  const basis = new THREE.Matrix4().makeBasis(frame.bankedLateral, frame.normal, frame.tangent);
  return new THREE.Quaternion().setFromRotationMatrix(basis);
}

function addAlignedBox(parent: THREE.Group, frame: TrackFrame, geo: THREE.BufferGeometry, mat: THREE.Material, lateralM: number, upM: number, ctx: TracksideContext, extraM = 1.0): THREE.Mesh {
  const safeLateral = resolveOutsideRunoff(lateralM, ctx, extraM);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.copy(frame.center).addScaledVector(frame.bankedLateral, safeLateral).addScaledVector(frame.normal, upM);
  mesh.quaternion.copy(frameQuaternion(frame));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  finalizeStaticMesh(mesh);
  return mesh;
}

const shared = {
  post: new THREE.BoxGeometry(0.18, 2.6, 0.18),
  board: new THREE.PlaneGeometry(2.5, 2.5),
  hut: new THREE.BoxGeometry(2.4, 2.4, 2.0),
  hutRoof: new THREE.BoxGeometry(2.8, 0.15, 2.4),
  fencePanel: new THREE.PlaneGeometry(8, 3),
  tire: new THREE.CylinderGeometry(0.33, 0.33, 0.25, 14),
  cone: new THREE.ConeGeometry(0.16, 0.52, 10),
  bollard: new THREE.CylinderGeometry(0.09, 0.11, 0.9, 10),
  techBox: new THREE.BoxGeometry(1.2, 1.4, 0.7),
  platform: new THREE.BoxGeometry(3.2, 0.3, 3.2),
  mast: new THREE.CylinderGeometry(0.12, 0.16, 7.5, 8),
  gateBeam: new THREE.BoxGeometry(7.5, 0.5, 0.5),
  signBoard: new THREE.PlaneGeometry(3.4, 1.7),
};
const mats = {
  steel: new THREE.MeshStandardMaterial({ color: 0x3a4552, metalness: 0.6, roughness: 0.45 }),
  dark: new THREE.MeshStandardMaterial({ color: 0x1f2937, roughness: 0.7 }),
  white: new THREE.MeshStandardMaterial({ color: 0xf1f5f9, roughness: 0.6 }),
  orange: new THREE.MeshStandardMaterial({ color: 0xf97316, roughness: 0.55 }),
  fence: new THREE.MeshStandardMaterial({ color: 0x9aa3ad, roughness: 0.5, metalness: 0.4, transparent: true, opacity: 0.55, side: THREE.DoubleSide }),
  tireBlack: new THREE.MeshStandardMaterial({ color: 0x17181c, roughness: 0.9 }),
  tireWhite: new THREE.MeshStandardMaterial({ color: 0xe5e7eb, roughness: 0.8 }),
  techGrey: new THREE.MeshStandardMaterial({ color: 0x64748b, roughness: 0.6 }),
  techYellow: new THREE.MeshStandardMaterial({ color: 0xfacc15, roughness: 0.6 }),
};

/** Coherent 150/100/50 braking-board family approaching a corner. */
export function buildBrakingBoardFamily(parent: THREE.Group, ctx: TracksideContext, opts: { approachU: number; side?: -1 | 1; labels?: string[]; spacingU?: number }): THREE.Group {
  const group = new THREE.Group();
  group.name = 'braking-board-family';
  const labels = opts.labels ?? ['150', '100', '50'];
  const spacing = opts.spacingU ?? 0.015;
  const side = opts.side ?? -1;
  labels.forEach((label, i) => {
    const frame = ctx.path.sampleAt(wrapU(opts.approachU - (labels.length - 1 - i) * spacing));
    const tex = makeFictionalNumberTexture(label);
    const mat = new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide });
    const board = new THREE.Mesh(shared.board, mat);
    const lateral = resolveOutsideRunoff(side * (ctx.barrierOffsetM + 2.0), ctx, 0);
    board.position.copy(frame.center).addScaledVector(frame.bankedLateral, lateral).addScaledVector(frame.normal, 2.0);
    board.rotation.y = Math.atan2(frame.tangent.x, frame.tangent.z) + Math.PI / 2;
    group.add(board);
    const post = new THREE.Mesh(shared.post, mats.steel);
    post.position.copy(board.position).addScaledVector(frame.normal, -1.8);
    group.add(post);
    finalizeStaticMesh(post);
  });
  parent.add(group);
  return group;
}

/** Marshal post: shelter + roof + light panel. Light color is static material state. */
export function buildMarshalPost(parent: THREE.Group, ctx: TracksideContext, opts: SidePlacement & { lightColor?: number }): THREE.Group {
  const group = new THREE.Group();
  group.name = 'marshal-post';
  const frame = ctx.path.sampleAt(wrapU(opts.u));
  const side = opts.side ?? 1;
  const lateral = resolveOutsideRunoff(side * (ctx.barrierOffsetM + 3.0), ctx, 0);
  const hut = addAlignedBox(group, frame, shared.hut, mats.white, lateral, 1.2, ctx, 0);
  hut.position.addScaledVector(frame.normal, 0);
  addAlignedBox(group, frame, shared.hutRoof, mats.orange, lateral, 2.55, ctx, 0);
  const lightMat = new THREE.MeshStandardMaterial({ color: 0x111827, emissive: opts.lightColor ?? 0x22c55e, emissiveIntensity: 1.4 });
  addAlignedBox(group, frame, new THREE.BoxGeometry(0.6, 0.9, 0.2), lightMat, lateral, 2.9, ctx, 0);
  parent.add(group);
  return group;
}

/** Timing / sector objects: sector board + loop cabinet on opposite sides. */
export function buildTimingSectorObjects(parent: THREE.Group, ctx: TracksideContext, opts: { u: number; sectorName: string }): THREE.Group {
  const group = new THREE.Group();
  group.name = 'timing-sector';
  const frame = ctx.path.sampleAt(wrapU(opts.u));
  const brand = fictionalBrandForSector(opts.u);
  const infoTex = makeFictionalInfoTexture(opts.sectorName, brand.displayName);
  const infoMat = new THREE.MeshBasicMaterial({ map: infoTex, side: THREE.DoubleSide });
  const board = new THREE.Mesh(shared.signBoard, infoMat);
  board.position.copy(frame.center).addScaledVector(frame.bankedLateral, resolveOutsideRunoff(ctx.barrierOffsetM + 2.5, ctx, 0)).addScaledVector(frame.normal, 2.2);
  board.rotation.y = Math.atan2(frame.tangent.x, frame.tangent.z) + Math.PI / 2;
  group.add(board);
  addAlignedBox(group, frame, shared.techBox, mats.techGrey, -(ctx.barrierOffsetM + 2.5), 0.7, ctx, 0);
  parent.add(group);
  return group;
}

/** Safety fence panel run + tire-wall cluster. All geometry starts outside barrierOffsetM. */
export function buildSafetyFenceAndTireWall(parent: THREE.Group, ctx: TracksideContext, opts: { u: number; panels?: number; side?: -1 | 1; tireStacks?: number }): THREE.Group {
  const group = new THREE.Group();
  group.name = 'fence-tirewall';
  const panels = opts.panels ?? 3;
  const side = opts.side ?? 1;
  for (let i = 0; i < panels; i++) {
    const frame = ctx.path.sampleAt(wrapU(opts.u + i * 0.002));
    const fence = addAlignedBox(group, frame, shared.fencePanel, mats.fence, side * (ctx.barrierOffsetM + 1.2), 2.0, ctx, 0);
    fence.castShadow = false;
  }
  const stacks = opts.tireStacks ?? 4;
  for (let s = 0; s < stacks; s++) {
    const frame = ctx.path.sampleAt(wrapU(opts.u + s * 0.0015));
    for (let row = 0; row < 3; row++) {
      const tire = addAlignedBox(group, frame, shared.tire, row === 1 ? mats.tireWhite : mats.tireBlack, side * (ctx.barrierOffsetM + 0.8) + s * 0.7, 0.2 + row * 0.26, ctx, 0);
      tire.castShadow = false;
    }
  }
  parent.add(group);
  return group;
}

/** Camera platform + mast + crane head box. */
export function buildCameraCraneOrPlatform(parent: THREE.Group, ctx: TracksideContext, opts: SidePlacement): THREE.Group {
  const group = new THREE.Group();
  group.name = 'camera-platform';
  const frame = ctx.path.sampleAt(wrapU(opts.u));
  const side = opts.side ?? -1;
  addAlignedBox(group, frame, shared.platform, mats.dark, side * (ctx.barrierOffsetM + 6), 3.0, ctx, 0);
  addAlignedBox(group, frame, shared.mast, mats.steel, side * (ctx.barrierOffsetM + 6), 6.5, ctx, 0);
  addAlignedBox(group, frame, new THREE.BoxGeometry(0.7, 0.5, 0.9), mats.dark, side * (ctx.barrierOffsetM + 6), 10.4, ctx, 0);
  parent.add(group);
  return group;
}

/** Service gate: frame + branded header + closed barrier arm (visual only). */
export function buildServiceGate(parent: THREE.Group, ctx: TracksideContext, opts: { u: number; side?: -1 | 1; gateName: string }): THREE.Group {
  const group = new THREE.Group();
  group.name = 'service-gate';
  const frame = ctx.path.sampleAt(wrapU(opts.u));
  const side = opts.side ?? 1;
  const brand = getFictionalBrand('aerofab');
  void brand;
  addAlignedBox(group, frame, shared.gateBeam, mats.techYellow, side * (ctx.barrierOffsetM + 2.0), 3.2, ctx, 0);
  const tex = makeFictionalInfoTexture(opts.gateName, 'SERVICE ONLY');
  const mat = new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide });
  const sign = new THREE.Mesh(shared.signBoard, mat);
  sign.position.copy(frame.center).addScaledVector(frame.bankedLateral, resolveOutsideRunoff(side * (ctx.barrierOffsetM + 2.0), ctx, 0)).addScaledVector(frame.normal, 4.4);
  sign.rotation.y = Math.atan2(frame.tangent.x, frame.tangent.z) + Math.PI / 2;
  group.add(sign);
  parent.add(group);
  return group;
}

/** Pit entry / exit direction sign (fictional series text only). */
export function buildPitEntryExitSign(parent: THREE.Group, ctx: TracksideContext, opts: { u: number; side?: -1 | 1; text: string; sub?: string }): THREE.Group {
  const group = new THREE.Group();
  group.name = 'pit-sign';
  const frame = ctx.path.sampleAt(wrapU(opts.u));
  const tex = makeFictionalInfoTexture(opts.text, opts.sub ?? 'SHOWCASE GP');
  const mat = new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide });
  const sign = new THREE.Mesh(shared.signBoard, mat);
  sign.position.copy(frame.center).addScaledVector(frame.bankedLateral, resolveOutsideRunoff((opts.side ?? -1) * (ctx.barrierOffsetM + 2.2), ctx, 0)).addScaledVector(frame.normal, 3.0);
  sign.rotation.y = Math.atan2(frame.tangent.x, frame.tangent.z) + Math.PI / 2;
  group.add(sign);
  const post = new THREE.Mesh(shared.post, mats.steel);
  post.position.copy(sign.position).addScaledVector(frame.normal, -1.8);
  group.add(post);
  finalizeStaticMesh(post);
  parent.add(group);
  return group;
}

/** Cones / bollards guarding a gate apron; always outside runoff. */
export function buildConesAndBollards(parent: THREE.Group, ctx: TracksideContext, opts: { u: number; side?: -1 | 1; count?: number }): THREE.Group {
  const group = new THREE.Group();
  group.name = 'cones-bollards';
  const count = opts.count ?? 5;
  const side = opts.side ?? 1;
  for (let i = 0; i < count; i++) {
    const frame = ctx.path.sampleAt(wrapU(opts.u + i * 0.0009));
    const geo = i % 2 === 0 ? shared.cone : shared.bollard;
    const mat = i % 2 === 0 ? mats.orange : mats.techYellow;
    addAlignedBox(group, frame, geo, mat, side * (ctx.barrierOffsetM + 1.6 + (i % 3) * 0.6), 0.3, ctx, 0);
  }
  parent.add(group);
  return group;
}

/** Trackside technical boxes: timing cabinet + power cabinet pair. */
export function buildTechnicalBoxes(parent: THREE.Group, ctx: TracksideContext, opts: SidePlacement): THREE.Group {
  const group = new THREE.Group();
  group.name = 'technical-boxes';
  const frame = ctx.path.sampleAt(wrapU(opts.u));
  const side = opts.side ?? 1;
  addAlignedBox(group, frame, shared.techBox, mats.techGrey, side * (ctx.barrierOffsetM + 2.2), 0.7, ctx, 0);
  addAlignedBox(group, frame, shared.techBox, mats.techYellow, side * (ctx.barrierOffsetM + 3.6), 0.7, ctx, 0);
  parent.add(group);
  return group;
}

/** Branded banner on posts spanning a runoff-exterior viewing mound. */
export function buildFictionalBanner(parent: THREE.Group, ctx: TracksideContext, opts: { u: number; brandId: string; side?: -1 | 1 }): THREE.Group {
  const group = new THREE.Group();
  group.name = 'fictional-banner';
  const frame = ctx.path.sampleAt(wrapU(opts.u));
  const mat = makeFictionalBannerMaterial(opts.brandId, { subText: 'SHOWCASE CIRCUIT' });
  const banner = new THREE.Mesh(new THREE.PlaneGeometry(9, 1.4), mat);
  banner.position.copy(frame.center).addScaledVector(frame.bankedLateral, resolveOutsideRunoff((opts.side ?? 1) * (ctx.barrierOffsetM + 3.0), ctx, 0)).addScaledVector(frame.normal, 1.6);
  banner.rotation.y = Math.atan2(frame.tangent.x, frame.tangent.z) + Math.PI / 2;
  group.add(banner);
  parent.add(group);
  return group;
}

export interface ClusterDef {
  kind: 'start-finish' | 'braking-approach' | 'technical' | 'summit' | 'service';
  u: number;
}
export const SHOWCASE_PROP_CLUSTERS: readonly ClusterDef[] = [
  { kind: 'start-finish', u: 0.018 },
  { kind: 'braking-approach', u: 0.81 },
  { kind: 'technical', u: 0.66 },
  { kind: 'summit', u: 0.43 },
  { kind: 'service', u: 0.36 },
];

/** Purposeful cluster composer for later integrator. Does not touch road/runoff. */
export function buildShowcaseTracksideProps(parent: THREE.Group, ctx: TracksideContext, clusters: readonly ClusterDef[] = SHOWCASE_PROP_CLUSTERS): THREE.Group {
  const root = new THREE.Group();
  root.name = 'showcase-trackside-props';
  for (const cluster of clusters) {
    const u = wrapU(cluster.u);
    if (cluster.kind === 'start-finish') {
      buildTimingSectorObjects(root, ctx, { u, sectorName: 'SECTOR 1' });
      buildMarshalPost(root, ctx, { u: u + 0.004, side: 1, lightColor: 0x22c55e });
      buildCameraCraneOrPlatform(root, ctx, { u: u - 0.004, side: -1 });
      buildFictionalBanner(root, ctx, { u: u + 0.008, brandId: fictionalBrandForSector(u).id, side: 1 });
      buildTechnicalBoxes(root, ctx, { u: u + 0.002, side: 1 });
    } else if (cluster.kind === 'braking-approach') {
      buildBrakingBoardFamily(root, ctx, { approachU: u, side: -1 });
      buildMarshalPost(root, ctx, { u: u + 0.006, side: 1, lightColor: 0xfacc15 });
      buildSafetyFenceAndTireWall(root, ctx, { u, panels: 4, side: 1, tireStacks: 5 });
      buildCameraCraneOrPlatform(root, ctx, { u: u + 0.010, side: -1 });
    } else if (cluster.kind === 'technical') {
      buildMarshalPost(root, ctx, { u, side: -1, lightColor: 0xfacc15 });
      buildSafetyFenceAndTireWall(root, ctx, { u: u - 0.004, panels: 3, side: -1, tireStacks: 4 });
      buildConesAndBollards(root, ctx, { u: u + 0.004, side: 1, count: 6 });
      buildTechnicalBoxes(root, ctx, { u: u + 0.008, side: 1 });
    } else if (cluster.kind === 'summit') {
      buildFictionalBanner(root, ctx, { u, brandId: 'nordlys', side: 1 });
      buildCameraCraneOrPlatform(root, ctx, { u: u + 0.005, side: 1 });
      buildTimingSectorObjects(root, ctx, { u: u - 0.005, sectorName: 'SECTOR 2' });
    } else {
      buildServiceGate(root, ctx, { u, side: 1, gateName: 'GATE 03' });
      buildPitEntryExitSign(root, ctx, { u: u - 0.006, side: -1, text: 'PIT IN', sub: 'LEFT LANE' });
      buildPitEntryExitSign(root, ctx, { u: u + 0.006, side: -1, text: 'PIT OUT', sub: 'MERGE LEFT' });
      buildConesAndBollards(root, ctx, { u, side: 1, count: 5 });
    }
  }
  parent.add(root);
  return root;
}

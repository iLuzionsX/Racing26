/**
 * Kenney Racing Kit (CC0) venue asset manifest.
 *
 * Deterministic allow-list only. NEVER add Kenney road/track meshes here:
 * the validated Showcase Circuit ribbon/surface provider stays authoritative.
 * This file is data only (no network, no three.js) so QA can import it headless.
 */
export const KENNEY_PACK_NAME = 'Kenney Racing Kit';
export const KENNEY_LICENSE = 'CC0 1.0 Universal';
export const KENNEY_UPSTREAM_URL = 'https://kenney.nl/assets/racing-kit';
export const KENNEY_MIRROR_BASE_URL =
  'https://raw.githubusercontent.com/eturner58/game-assets/main/kenney/3D%20assets/Racing%20Kit/Models/GLTF%20format/';
export const KENNEY_BASE_URL = KENNEY_MIRROR_BASE_URL;

export type KenneyVenueAssetId =
  | 'grandStandCovered'
  | 'grandStandCoveredRound'
  | 'pitsGarage'
  | 'pitsOffice'
  | 'fenceStraight'
  | 'billboard'
  | 'camera_exclusive'
  | 'tentLong'
  | 'lightPostModern'
  | 'flagCheckersSmall'
  | 'radarEquipment'
  | 'raceCarGreen'
  | 'raceCarOrange';

export type KenneyVenueCategory =
  | 'grandstand'
  | 'pits'
  | 'fence'
  | 'signage'
  | 'lighting'
  | 'prop'
  | 'displayVehicle';

export interface KenneyVenueAssetEntry {
  id: KenneyVenueAssetId;
  file: string;
  url: string;
  category: KenneyVenueCategory;
  targetHeightM?: number;
  targetLengthM?: number;
  castShadow: boolean;
  receiveShadow: boolean;
}

function entry(
  id: KenneyVenueAssetId,
  file: string,
  category: KenneyVenueCategory,
  opts: Partial<Pick<KenneyVenueAssetEntry, 'targetHeightM' | 'targetLengthM' | 'castShadow' | 'receiveShadow'>> = {},
): KenneyVenueAssetEntry {
  return {
    id,
    file,
    url: `${KENNEY_BASE_URL}${file}`,
    category,
    castShadow: opts.castShadow ?? true,
    receiveShadow: opts.receiveShadow ?? true,
    ...(opts.targetHeightM !== undefined ? { targetHeightM: opts.targetHeightM } : {}),
    ...(opts.targetLengthM !== undefined ? { targetLengthM: opts.targetLengthM } : {}),
  };
}

export const KENNEY_VENUE_ASSETS: Record<KenneyVenueAssetId, KenneyVenueAssetEntry> = {
  grandStandCovered: entry('grandStandCovered', 'grandStandCovered.glb', 'grandstand', { targetHeightM: 7.5 }),
  grandStandCoveredRound: entry('grandStandCoveredRound', 'grandStandCoveredRound.glb', 'grandstand', { targetHeightM: 7.5 }),
  pitsGarage: entry('pitsGarage', 'pitsGarage.glb', 'pits', { targetHeightM: 3.8 }),
  pitsOffice: entry('pitsOffice', 'pitsOffice.glb', 'pits', { targetHeightM: 5.2 }),
  fenceStraight: entry('fenceStraight', 'fenceStraight.glb', 'fence', { targetHeightM: 2.2, receiveShadow: false }),
  billboard: entry('billboard', 'billboard.glb', 'signage', { targetHeightM: 5.0 }),
  camera_exclusive: entry('camera_exclusive', 'camera_exclusive.glb', 'prop', { targetHeightM: 1.8, receiveShadow: false }),
  tentLong: entry('tentLong', 'tentLong.glb', 'pits', { targetHeightM: 3.2 }),
  lightPostModern: entry('lightPostModern', 'lightPostModern.glb', 'lighting', { targetHeightM: 9.0, receiveShadow: false }),
  flagCheckersSmall: entry('flagCheckersSmall', 'flagCheckersSmall.glb', 'prop', { targetHeightM: 4.0, receiveShadow: false }),
  radarEquipment: entry('radarEquipment', 'radarEquipment.glb', 'prop', { targetHeightM: 2.0, receiveShadow: false }),
  raceCarGreen: entry('raceCarGreen', 'raceCarGreen.glb', 'displayVehicle', { targetHeightM: 1.25, targetLengthM: 4.2 }),
  raceCarOrange: entry('raceCarOrange', 'raceCarOrange.glb', 'displayVehicle', { targetHeightM: 1.25, targetLengthM: 4.2 }),
};

export const KENNEY_VENUE_ASSET_IDS: KenneyVenueAssetId[] = [
  'grandStandCovered',
  'grandStandCoveredRound',
  'pitsGarage',
  'pitsOffice',
  'fenceStraight',
  'billboard',
  'camera_exclusive',
  'tentLong',
  'lightPostModern',
  'flagCheckersSmall',
  'radarEquipment',
  'raceCarGreen',
  'raceCarOrange',
];

export function kenneyAssetUrl(id: KenneyVenueAssetId): string {
  return KENNEY_VENUE_ASSETS[id].url;
}

/** Substrings that must never appear in a venue asset file/id. */
export const KENNEY_FORBIDDEN_ROAD_PATTERNS = ['road', 'track', 'circuit', 'asphalt', 'curve', 'chicane', 'straightroad'];

export function isForbiddenRoadAsset(fileOrId: string): boolean {
  const lower = fileOrId.toLowerCase();
  return KENNEY_FORBIDDEN_ROAD_PATTERNS.some((p) => lower.includes(p));
}

export function assertNoRoadMesh(id: KenneyVenueAssetId): void {
  const e = KENNEY_VENUE_ASSETS[id];
  if (isForbiddenRoadAsset(e.file) || isForbiddenRoadAsset(e.id)) {
    throw new Error(`[kenney] road/track mesh forbidden in venue pass: ${e.id} (${e.file})`);
  }
}

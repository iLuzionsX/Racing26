export type MobileControlOrientation = 'portrait' | 'landscape';
export type MobileControlClusterId = 'wheel' | 'pedals';

export interface MobileClusterLayout {
  /** Viewport-normalized center position. */
  x: number;
  y: number;
  /** Uniform visual/input hit-target scale. */
  scale: number;
}

export interface MobileControlLayoutPair {
  wheel: MobileClusterLayout;
  pedals: MobileClusterLayout;
}

export interface MobileControlLayoutStore {
  version: 1;
  portrait: MobileControlLayoutPair;
  landscape: MobileControlLayoutPair;
}

export interface MobileSafeAreaPx {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export interface MobileViewportPx {
  width: number;
  height: number;
}

export interface MobileClusterBoundsPx {
  width: number;
  height: number;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

export const MOBILE_CONTROL_LAYOUT_VERSION = 1 as const;
export const MOBILE_CONTROL_LAYOUT_STORAGE_KEY = 'racing26.mobileControls.layout.v1';

export const MOBILE_WHEEL_SCALE_MIN = 0.7;
export const MOBILE_WHEEL_SCALE_MAX = 1.5;
export const MOBILE_PEDALS_SCALE_MIN = 0.7;
export const MOBILE_PEDALS_SCALE_MAX = 1.4;
export const MOBILE_LAYOUT_EDGE_MARGIN_PX = 12;

const makeDefaults = (): MobileControlLayoutStore => ({
  version: MOBILE_CONTROL_LAYOUT_VERSION,
  portrait: {
    wheel: { x: 0.24, y: 0.8, scale: 1 },
    pedals: { x: 0.76, y: 0.8, scale: 1 },
  },
  landscape: {
    wheel: { x: 0.18, y: 0.78, scale: 1 },
    pedals: { x: 0.83, y: 0.78, scale: 1 },
  },
});

export const DEFAULT_MOBILE_CONTROL_LAYOUT = makeDefaults();

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

const finiteNumber = (value: unknown, fallback: number) =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;

const cloneCluster = (cluster: MobileClusterLayout): MobileClusterLayout => ({ ...cluster });

export const cloneMobileControlLayoutStore = (
  store: MobileControlLayoutStore
): MobileControlLayoutStore => ({
  version: MOBILE_CONTROL_LAYOUT_VERSION,
  portrait: {
    wheel: cloneCluster(store.portrait.wheel),
    pedals: cloneCluster(store.portrait.pedals),
  },
  landscape: {
    wheel: cloneCluster(store.landscape.wheel),
    pedals: cloneCluster(store.landscape.pedals),
  },
});

export const getDefaultMobileControlPair = (
  orientation: MobileControlOrientation
): MobileControlLayoutPair => {
  const defaults = makeDefaults()[orientation];
  return {
    wheel: cloneCluster(defaults.wheel),
    pedals: cloneCluster(defaults.pedals),
  };
};

const sanitizeCluster = (
  value: unknown,
  fallback: MobileClusterLayout,
  kind: MobileControlClusterId
): MobileClusterLayout => {
  const source =
    value && typeof value === 'object'
      ? (value as Partial<MobileClusterLayout>)
      : {};

  const scaleMin =
    kind === 'wheel' ? MOBILE_WHEEL_SCALE_MIN : MOBILE_PEDALS_SCALE_MIN;
  const scaleMax =
    kind === 'wheel' ? MOBILE_WHEEL_SCALE_MAX : MOBILE_PEDALS_SCALE_MAX;

  return {
    x: clamp(finiteNumber(source.x, fallback.x), 0, 1),
    y: clamp(finiteNumber(source.y, fallback.y), 0, 1),
    scale: clamp(finiteNumber(source.scale, fallback.scale), scaleMin, scaleMax),
  };
};

const sanitizePair = (
  value: unknown,
  fallback: MobileControlLayoutPair
): MobileControlLayoutPair => {
  const source =
    value && typeof value === 'object'
      ? (value as Partial<MobileControlLayoutPair>)
      : {};

  return {
    wheel: sanitizeCluster(source.wheel, fallback.wheel, 'wheel'),
    pedals: sanitizeCluster(source.pedals, fallback.pedals, 'pedals'),
  };
};

export const sanitizeMobileControlLayoutStore = (
  value: unknown
): MobileControlLayoutStore => {
  const defaults = makeDefaults();

  if (!value || typeof value !== 'object') return defaults;
  const source = value as Partial<MobileControlLayoutStore>;
  if (source.version !== MOBILE_CONTROL_LAYOUT_VERSION) return defaults;

  return {
    version: MOBILE_CONTROL_LAYOUT_VERSION,
    portrait: sanitizePair(source.portrait, defaults.portrait),
    landscape: sanitizePair(source.landscape, defaults.landscape),
  };
};

export const parseMobileControlLayoutStore = (
  raw: string | null | undefined
): MobileControlLayoutStore => {
  if (!raw || raw.length > 20_000) return makeDefaults();

  try {
    return sanitizeMobileControlLayoutStore(JSON.parse(raw));
  } catch {
    return makeDefaults();
  }
};

export const serializeMobileControlLayoutStore = (
  store: MobileControlLayoutStore
) => JSON.stringify(sanitizeMobileControlLayoutStore(store));

const browserStorage = (): StorageLike | null => {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
};

export const loadMobileControlLayoutStore = (
  storage: StorageLike | null = browserStorage()
): MobileControlLayoutStore => {
  try {
    return parseMobileControlLayoutStore(
      storage?.getItem(MOBILE_CONTROL_LAYOUT_STORAGE_KEY)
    );
  } catch {
    return makeDefaults();
  }
};

export const saveMobileControlLayoutStore = (
  store: MobileControlLayoutStore,
  storage: StorageLike | null = browserStorage()
) => {
  try {
    storage?.setItem(
      MOBILE_CONTROL_LAYOUT_STORAGE_KEY,
      serializeMobileControlLayoutStore(store)
    );
  } catch {
    // Private browsing/quota failures should never affect driving input.
  }
};

export const resetStoredMobileControlLayout = (
  storage: StorageLike | null = browserStorage()
) => {
  try {
    storage?.removeItem?.(MOBILE_CONTROL_LAYOUT_STORAGE_KEY);
  } catch {
    // Ignore storage failures and return clean defaults.
  }
  return makeDefaults();
};

export const mobileControlOrientationForViewport = (
  width: number,
  height: number
): MobileControlOrientation =>
  Number.isFinite(width) &&
  Number.isFinite(height) &&
  width > height
    ? 'landscape'
    : 'portrait';

export const updateMobileControlCluster = (
  pair: MobileControlLayoutPair,
  id: MobileControlClusterId,
  patch: Partial<MobileClusterLayout>
): MobileControlLayoutPair => ({
  ...pair,
  [id]: sanitizeCluster(
    { ...pair[id], ...patch },
    pair[id],
    id
  ),
});

export const clampMobileClusterCenter = (
  center: Pick<MobileClusterLayout, 'x' | 'y'>,
  viewport: MobileViewportPx,
  bounds: MobileClusterBoundsPx,
  safeArea: MobileSafeAreaPx,
  marginPx = MOBILE_LAYOUT_EDGE_MARGIN_PX
) => {
  const width = Math.max(1, viewport.width);
  const height = Math.max(1, viewport.height);
  const halfWidth = Math.max(0, bounds.width) / 2;
  const halfHeight = Math.max(0, bounds.height) / 2;
  const margin = Math.max(0, marginPx);

  const minX = (Math.max(0, safeArea.left) + halfWidth + margin) / width;
  const maxX =
    1 - (Math.max(0, safeArea.right) + halfWidth + margin) / width;
  const minY = (Math.max(0, safeArea.top) + halfHeight + margin) / height;
  const maxY =
    1 - (Math.max(0, safeArea.bottom) + halfHeight + margin) / height;

  return {
    x:
      maxX >= minX
        ? clamp(finiteNumber(center.x, 0.5), minX, maxX)
        : 0.5,
    y:
      maxY >= minY
        ? clamp(finiteNumber(center.y, 0.5), minY, maxY)
        : 0.5,
  };
};

export const resolveMobileClusterDrag = (
  startCenter: Pick<MobileClusterLayout, 'x' | 'y'>,
  deltaClientX: number,
  deltaClientY: number,
  viewport: MobileViewportPx,
  bounds: MobileClusterBoundsPx,
  safeArea: MobileSafeAreaPx
) =>
  clampMobileClusterCenter(
    {
      x: startCenter.x + deltaClientX / Math.max(1, viewport.width),
      y: startCenter.y + deltaClientY / Math.max(1, viewport.height),
    },
    viewport,
    bounds,
    safeArea
  );

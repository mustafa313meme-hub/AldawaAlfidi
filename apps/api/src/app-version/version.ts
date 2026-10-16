/** Pure app-version helpers (SRS §107): "update the app to continue" when below the minimum supported version. */

const VERSION = /^\d+(\.\d+){0,3}$/;

export function parseVersion(v: string): number[] | null {
  const t = v.trim();
  return VERSION.test(t) ? t.split('.').map(Number) : null;
}

/** -1 / 0 / 1 for dotted numeric versions ("1.2" == "1.2.0"). Throws RangeError on anything else. */
export function compareVersions(a: string, b: string): -1 | 0 | 1 {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (!pa || !pb) throw new RangeError('invalid version');
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

export interface PlatformConfig {
  latest?: string;
  minSupported?: string;
  url?: string;
  notes?: string;
}

export interface UpdateInfo {
  updateAvailable: boolean;
  forceUpdate: boolean;
  latest: string | null;
  minSupported: string | null;
  url: string | null;
  notes: string | null;
  message: string | null;
}

export const FORCE_MESSAGE = 'يرجى تحديث التطبيق للاستمرار';

export function evaluateUpdate(current: string, cfg: PlatformConfig | undefined): UpdateInfo {
  const none: UpdateInfo = { updateAvailable: false, forceUpdate: false, latest: null, minSupported: null, url: null, notes: null, message: null };
  if (!cfg) return none;
  const force = !!cfg.minSupported && compareVersions(current, cfg.minSupported) < 0;
  const available = !!cfg.latest && compareVersions(current, cfg.latest) < 0;
  return {
    updateAvailable: available || force, forceUpdate: force, latest: cfg.latest ?? null, minSupported: cfg.minSupported ?? null,
    url: cfg.url ?? null, notes: cfg.notes ?? null, message: force ? FORCE_MESSAGE : null,
  };
}

/** Validates the `app_versions` setting: { android?: PlatformConfig, ios?: PlatformConfig }. */
export function isValidAppVersions(v: unknown): boolean {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false;
  for (const [platform, cfg] of Object.entries(v as Record<string, unknown>)) {
    if (platform !== 'android' && platform !== 'ios') return false;
    if (typeof cfg !== 'object' || cfg === null) return false;
    const c = cfg as Record<string, unknown>;
    for (const k of Object.keys(c)) if (!['latest', 'minSupported', 'url', 'notes'].includes(k)) return false;
    for (const k of ['latest', 'minSupported']) if (c[k] !== undefined && (typeof c[k] !== 'string' || !parseVersion(c[k] as string))) return false;
    for (const k of ['url', 'notes']) if (c[k] !== undefined && (typeof c[k] !== 'string' || (c[k] as string).length > 500)) return false;
    if (c.latest && c.minSupported && compareVersions(c.minSupported as string, c.latest as string) > 0) return false; // min above latest makes no sense
  }
  return true;
}

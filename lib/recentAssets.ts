const RECENT_ASSETS_KEY = "fan_recent_asset_ids";
const MAX_RECENT_ASSETS = 20;
const assetIdPattern = /^[a-zA-Z0-9_-]{1,128}$/;

function canUseStorage(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function normalizeAssetId(value: string): string {
  return value.trim();
}

export function isValidAssetId(value: string): boolean {
  return assetIdPattern.test(normalizeAssetId(value));
}

function sanitizeRecentList(values: readonly string[]): string[] {
  const out: string[] = [];
  for (const raw of values) {
    if (typeof raw !== "string") {
      continue;
    }
    const normalized = normalizeAssetId(raw);
    if (!isValidAssetId(normalized)) {
      continue;
    }
    if (out.includes(normalized)) {
      continue;
    }
    out.push(normalized);
    if (out.length >= MAX_RECENT_ASSETS) {
      break;
    }
  }
  return out;
}

function persistRecent(values: readonly string[]): void {
  if (!canUseStorage()) {
    return;
  }
  const sanitized = sanitizeRecentList(values);
  window.localStorage.setItem(RECENT_ASSETS_KEY, JSON.stringify(sanitized));
}

export function loadRecent(): string[] {
  if (!canUseStorage()) {
    return [];
  }

  const raw = window.localStorage.getItem(RECENT_ASSETS_KEY);
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return sanitizeRecentList(parsed);
  } catch {
    return [];
  }
}

export function addRecent(assetId: string): string[] {
  const normalized = normalizeAssetId(assetId);
  if (!isValidAssetId(normalized)) {
    return loadRecent();
  }

  const existing = loadRecent().filter((value) => value !== normalized);
  const merged = [normalized, ...existing].slice(0, MAX_RECENT_ASSETS);
  persistRecent(merged);
  return merged;
}

export function clearRecent(): void {
  if (!canUseStorage()) {
    return;
  }
  window.localStorage.removeItem(RECENT_ASSETS_KEY);
}

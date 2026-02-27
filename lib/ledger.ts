import { createHash } from "crypto";
import type {
  LedgerEntry,
  LedgerKind,
  LedgerListResponse,
  LedgerStatus,
  SpendSummaryTotals,
  TopAssetSpend,
  TopPayeeSpend
} from "./types";

const validKinds = new Set<LedgerKind>(["access", "boost"]);
const validStatuses = new Set<LedgerStatus>(["pending", "paid", "expired", "failed", "refunded"]);
const assetIDPattern = /^[a-zA-Z0-9_-]{1,128}$/;

export const defaultLedgerLimit = 20;
export const maxLedgerLimit = 100;
export const ledgerRequestTimeoutMs = 5000;
export const spendSummaryMaxPages = 10;
export const spendSummaryTopLimit = 20;

export type SpendAggregation = {
  totals: SpendSummaryTotals;
  byAssetID: Map<string, number>;
  byPayeeID: Map<string, number>;
  paidItemsCount: number;
};

export type AssetLabel = {
  asset_id: string;
  title?: string;
  artist_handle?: string;
  artist_display_name?: string;
};

function parseRecord(payloadText: string): Record<string, unknown> {
  const parsed = JSON.parse(payloadText) as unknown;
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("invalid JSON payload");
  }
  return parsed as Record<string, unknown>;
}

export function parseErrorMessage(payloadText: string): string {
  const trimmed = payloadText.trim();
  if (!trimmed) {
    return "";
  }
  try {
    const parsed = parseRecord(trimmed);
    const nestedError = parsed.error;
    if (typeof nestedError === "string") {
      return nestedError;
    }
    if (typeof nestedError === "object" && nestedError !== null) {
      const nested = nestedError as Record<string, unknown>;
      if (typeof nested.message === "string") {
        return nested.message;
      }
      if (typeof nested.code === "string") {
        return nested.code;
      }
    }
    if (typeof parsed.message === "string") {
      return parsed.message;
    }
  } catch {
    return trimmed;
  }
  return trimmed;
}

export function parseLedgerKind(value: string | null): LedgerKind | null {
  const raw = value?.trim() ?? "";
  if (!raw) {
    return null;
  }
  if (!validKinds.has(raw as LedgerKind)) {
    throw new Error("kind is invalid");
  }
  return raw as LedgerKind;
}

export function parseLedgerStatus(value: string | null): LedgerStatus | null {
  const raw = value?.trim() ?? "";
  if (!raw) {
    return null;
  }
  if (!validStatuses.has(raw as LedgerStatus)) {
    throw new Error("status is invalid");
  }
  return raw as LedgerStatus;
}

export function parseLedgerCursor(value: string | null): string | null {
  const raw = value?.trim() ?? "";
  if (!raw) {
    return null;
  }
  if (raw.length > 256) {
    throw new Error("cursor is too long");
  }
  return raw;
}

export function parseLedgerLimit(value: string | null): number {
  const raw = value?.trim() ?? "";
  if (!raw) {
    return defaultLedgerLimit;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error("limit must be a positive integer");
  }
  return Math.min(parsed, maxLedgerLimit);
}

export function parseUnixSeconds(value: string | null, fieldName: string): number | null {
  const raw = value?.trim() ?? "";
  if (!raw) {
    return null;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${fieldName} must be unix seconds`);
  }
  return parsed;
}

export function resolveTimeWindow(
  fromRaw: string | null,
  toRaw: string | null,
  defaultWindowSeconds: number
): { from: number; to: number } {
  const now = Math.floor(Date.now() / 1000);
  const from = parseUnixSeconds(fromRaw, "from");
  const to = parseUnixSeconds(toRaw, "to");
  const resolvedTo = to ?? now;
  const resolvedFrom = from ?? Math.max(1, resolvedTo - defaultWindowSeconds);
  if (resolvedFrom > resolvedTo) {
    throw new Error("from must be <= to");
  }
  return {
    from: resolvedFrom,
    to: resolvedTo
  };
}

export function isValidAssetID(value: string): boolean {
  return assetIDPattern.test(value.trim());
}

function parseLedgerEntry(rawValue: unknown): LedgerEntry | null {
  if (typeof rawValue !== "object" || rawValue === null) {
    return null;
  }
  const raw = rawValue as Record<string, unknown>;

  const entryID = typeof raw.entry_id === "string" ? raw.entry_id.trim() : "";
  const kind = typeof raw.kind === "string" ? raw.kind.trim() : "";
  const status = typeof raw.status === "string" ? raw.status.trim() : "";
  const payeeID = typeof raw.payee_id === "string" ? raw.payee_id.trim() : "";
  const currency = typeof raw.currency === "string" ? raw.currency.trim() : "";
  const amountMSat =
    typeof raw.amount_msat === "number" && Number.isFinite(raw.amount_msat)
      ? Math.trunc(raw.amount_msat)
      : Number.NaN;
  const createdAt =
    typeof raw.created_at === "number" && Number.isFinite(raw.created_at)
      ? Math.trunc(raw.created_at)
      : Number.NaN;
  const updatedAt =
    typeof raw.updated_at === "number" && Number.isFinite(raw.updated_at)
      ? Math.trunc(raw.updated_at)
      : Number.NaN;
  const paidAt =
    typeof raw.paid_at === "number" && Number.isFinite(raw.paid_at) ? Math.trunc(raw.paid_at) : null;
  const assetID = typeof raw.asset_id === "string" ? raw.asset_id.trim() : "";
  const referenceID = typeof raw.reference_id === "string" ? raw.reference_id.trim() : "";

  if (
    !entryID ||
    !validKinds.has(kind as LedgerKind) ||
    !validStatuses.has(status as LedgerStatus) ||
    !payeeID ||
    !currency ||
    !Number.isFinite(amountMSat) ||
    amountMSat < 0 ||
    !Number.isFinite(createdAt) ||
    createdAt <= 0 ||
    !Number.isFinite(updatedAt) ||
    updatedAt <= 0
  ) {
    return null;
  }

  const normalizedAssetID = assetID && isValidAssetID(assetID) ? assetID : undefined;
  return {
    entry_id: entryID,
    kind: kind as LedgerKind,
    status: status as LedgerStatus,
    asset_id: normalizedAssetID,
    payee_id: payeeID,
    amount_msat: amountMSat,
    currency,
    created_at: createdAt,
    updated_at: updatedAt,
    paid_at: paidAt,
    reference_id: referenceID || undefined
  };
}

export function parseLedgerListResponse(payloadText: string): LedgerListResponse {
  const parsed = parseRecord(payloadText);
  const itemsRaw = Array.isArray(parsed.items) ? parsed.items : [];
  const nextCursor = typeof parsed.next_cursor === "string" ? parsed.next_cursor.trim() : undefined;
  const deviceID = typeof parsed.device_id === "string" ? parsed.device_id.trim() : undefined;

  const items: LedgerEntry[] = [];
  for (const raw of itemsRaw) {
    const parsedEntry = parseLedgerEntry(raw);
    if (parsedEntry) {
      items.push(parsedEntry);
    }
  }

  return {
    device_id: deviceID,
    items,
    next_cursor: nextCursor || undefined
  };
}

export function filterEntriesByWindow(
  items: LedgerEntry[],
  fromInclusive: number,
  toInclusive: number
): LedgerEntry[] {
  return items.filter((item) => item.created_at >= fromInclusive && item.created_at <= toInclusive);
}

export function aggregatePaidEntries(items: LedgerEntry[]): SpendAggregation {
  let accessTotal = 0;
  let boostTotal = 0;
  const byAssetID = new Map<string, number>();
  const byPayeeID = new Map<string, number>();
  let paidItemsCount = 0;

  for (const item of items) {
    if (item.status !== "paid") {
      continue;
    }
    paidItemsCount += 1;
    if (item.kind === "access") {
      accessTotal += item.amount_msat;
    } else if (item.kind === "boost") {
      boostTotal += item.amount_msat;
    }
    byPayeeID.set(item.payee_id, (byPayeeID.get(item.payee_id) ?? 0) + item.amount_msat);
    if (item.asset_id) {
      byAssetID.set(item.asset_id, (byAssetID.get(item.asset_id) ?? 0) + item.amount_msat);
    }
  }

  return {
    totals: {
      total_paid_msat_access: accessTotal,
      total_paid_msat_boost: boostTotal,
      total_paid_msat_all: accessTotal + boostTotal
    },
    byAssetID,
    byPayeeID,
    paidItemsCount
  };
}

function sortByAmountDesc<T extends { amount_msat: number }>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    if (b.amount_msat !== a.amount_msat) {
      return b.amount_msat - a.amount_msat;
    }
    return 0;
  });
}

export function buildTopAssets(
  byAssetID: Map<string, number>,
  assetLabels: Map<string, AssetLabel>
): TopAssetSpend[] {
  const items: TopAssetSpend[] = [];
  for (const [assetID, amountMSat] of byAssetID.entries()) {
    const label = assetLabels.get(assetID);
    items.push({
      asset_id: assetID,
      title: label?.title,
      artist_handle: label?.artist_handle,
      artist_display_name: label?.artist_display_name,
      amount_msat: amountMSat
    });
  }
  return sortByAmountDesc(items).slice(0, spendSummaryTopLimit);
}

export function buildTopPayees(
  byPayeeID: Map<string, number>,
  payeeArtistLabels: Map<string, { artist_handle?: string; artist_display_name?: string }>
): TopPayeeSpend[] {
  const items: TopPayeeSpend[] = [];
  for (const [payeeID, amountMSat] of byPayeeID.entries()) {
    const label = payeeArtistLabels.get(payeeID);
    items.push({
      payee_id: payeeID,
      amount_msat: amountMSat,
      artist_handle: label?.artist_handle,
      artist_display_name: label?.artist_display_name
    });
  }
  return sortByAmountDesc(items).slice(0, spendSummaryTopLimit);
}

export async function fetchTextWithTimeout(
  url: string,
  timeoutMs: number,
  init?: RequestInit
): Promise<{ status: number; text: string; contentType: string; setCookie: string | null }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
      cache: "no-store"
    });
    return {
      status: response.status,
      text: await response.text(),
      contentType: response.headers.get("content-type") ?? "application/json",
      setCookie: response.headers.get("set-cookie")
    };
  } finally {
    clearTimeout(timeout);
  }
}

export function hashCookieForCache(cookieHeader: string): string {
  return createHash("sha256").update(cookieHeader).digest("hex");
}

export function parseAssetLookupLabel(payloadText: string): AssetLabel {
  const parsed = parseRecord(payloadText);
  const asset = typeof parsed.asset === "object" && parsed.asset !== null ? parsed.asset : null;
  const artist = typeof parsed.artist === "object" && parsed.artist !== null ? parsed.artist : null;
  if (!asset) {
    throw new Error("asset lookup payload is invalid");
  }
  const assetRecord = asset as Record<string, unknown>;
  const artistRecord = artist as Record<string, unknown> | null;
  const assetID = typeof assetRecord.asset_id === "string" ? assetRecord.asset_id.trim() : "";
  if (!isValidAssetID(assetID)) {
    throw new Error("asset lookup payload is invalid");
  }
  const title = typeof assetRecord.title === "string" ? assetRecord.title.trim() : undefined;
  const artistHandle =
    artistRecord && typeof artistRecord.handle === "string" ? artistRecord.handle.trim() : undefined;
  const artistDisplayName =
    artistRecord && typeof artistRecord.display_name === "string"
      ? artistRecord.display_name.trim()
      : undefined;

  return {
    asset_id: assetID,
    title: title || undefined,
    artist_handle: artistHandle || undefined,
    artist_display_name: artistDisplayName || undefined
  };
}

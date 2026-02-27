import { createHash } from "crypto";
import type { LedgerEntry, LedgerKind, LedgerListResponse, LedgerStatus } from "./types";

const validKinds = new Set<LedgerKind>(["access", "boost"]);
const validStatuses = new Set<LedgerStatus>(["pending", "paid", "expired", "failed", "refunded"]);
const assetIDPattern = /^[a-zA-Z0-9_-]{1,128}$/;

export const defaultLedgerLimit = 50;
export const maxLedgerLimit = 100;
export const ledgerRequestTimeoutMs = 5000;
export const spendSummaryMaxPages = 10;
export const spendSummaryTopLimit = 20;

export type WindowDays = 7 | 30;

export type AssetPlaybackLabel = {
  asset_id: string;
  title?: string;
  artist?: string;
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

export function parseLedgerLimit(value: string | null, fallback = defaultLedgerLimit): number {
  const raw = value?.trim() ?? "";
  if (!raw) {
    return fallback;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error("limit must be a positive integer");
  }
  return Math.min(parsed, maxLedgerLimit);
}

export function parseFromDays(value: string | null): WindowDays {
  const raw = value?.trim() ?? "";
  if (!raw || raw === "30") {
    return 30;
  }
  if (raw === "7") {
    return 7;
  }
  throw new Error("fromDays must be 7 or 30");
}

export function resolveWindowTimestamps(windowDays: WindowDays): { from: number; to: number } {
  const to = Math.floor(Date.now() / 1000);
  const from = Math.max(1, to - windowDays * 24 * 60 * 60);
  return { from, to };
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
    device_id: deviceID || undefined,
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

export function parsePlaybackLabel(payloadText: string, expectedAssetID: string): AssetPlaybackLabel {
  const parsed = parseRecord(payloadText);
  const assetRaw = parsed.asset;
  if (typeof assetRaw !== "object" || assetRaw === null) {
    throw new Error("playback payload is invalid");
  }
  const asset = assetRaw as Record<string, unknown>;
  const assetID = typeof asset.asset_id === "string" ? asset.asset_id.trim() : "";
  if (assetID === "" || (expectedAssetID !== "" && assetID !== expectedAssetID)) {
    throw new Error("playback asset mismatch");
  }

  const title = typeof asset.title === "string" ? asset.title.trim() : "";
  const artistRaw = parsed.artist;
  let artist = "";
  if (typeof artistRaw === "object" && artistRaw !== null) {
    const artistRecord = artistRaw as Record<string, unknown>;
    const handle = typeof artistRecord.handle === "string" ? artistRecord.handle.trim() : "";
    const displayName =
      typeof artistRecord.display_name === "string" ? artistRecord.display_name.trim() : "";
    artist = displayName || (handle ? `@${handle}` : "");
  }
  return {
    asset_id: assetID,
    title: title || undefined,
    artist: artist || undefined
  };
}

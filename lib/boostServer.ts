import type { PlaybackResponse } from "./types";

const assetIdPattern = /^[a-zA-Z0-9_-]{1,128}$/;
const boostIdPattern = /^[a-zA-Z0-9_-]{1,128}$/;
const idempotencyKeyPattern = /^[a-zA-Z0-9._:-]{8,128}$/;

export const boostRequestTimeoutMs = 5000;
export const maxBoostSats = 50_000;
export const defaultBoostListLimit = 20;
export const maxBoostListLimit = 100;

const allowedBoostStatuses = new Set(["pending", "paid", "expired", "failed"]);

export type BoostContext = {
  assetId: string;
  fapUrl: string;
  fapPayeeId: string;
  payeeId: string;
};

function parseHTTPURL(name: string, rawValue: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(rawValue);
  } catch {
    throw new Error(`${name} is invalid`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`${name} must use http/https`);
  }
  return parsed;
}

function isLoopbackHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1" || hostname === "[::1]";
}

export function parseAssetId(value: string): string {
  const trimmed = value.trim();
  if (!assetIdPattern.test(trimmed)) {
    throw new Error("assetId is invalid");
  }
  return trimmed;
}

export function parseBoostId(value: string): string {
  const trimmed = value.trim();
  if (!boostIdPattern.test(trimmed)) {
    throw new Error("boostId is invalid");
  }
  return trimmed;
}

export function parseAmountSats(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error("amountSats must be a number");
  }
  const integer = Math.trunc(value);
  if (integer <= 0 || integer > maxBoostSats) {
    throw new Error(`amountSats must be 1..${maxBoostSats}`);
  }
  return integer;
}

export function parseMemo(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  if (trimmed.length > 256) {
    throw new Error("memo must be <= 256 chars");
  }
  return trimmed;
}

export function parseIdempotencyKey(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  if (!idempotencyKeyPattern.test(trimmed)) {
    throw new Error("idempotencyKey is invalid");
  }
  return trimmed;
}

export function parseBoostListLimit(value: string | null): number {
  const raw = value?.trim() ?? "";
  if (!raw) {
    return defaultBoostListLimit;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error("limit must be a positive integer");
  }
  return Math.min(parsed, maxBoostListLimit);
}

export function parseBoostListStatus(value: string | null): string | null {
  const raw = value?.trim() ?? "";
  if (!raw) {
    return null;
  }
  if (!allowedBoostStatuses.has(raw)) {
    throw new Error("status is invalid");
  }
  return raw;
}

export function parseBoostListCursor(value: string | null): string | null {
  const raw = value?.trim() ?? "";
  if (!raw) {
    return null;
  }
  if (raw.length > 256) {
    throw new Error("cursor is too long");
  }
  return raw;
}

export function parsePlaybackResponse(payloadText: string): PlaybackResponse {
  const parsed = JSON.parse(payloadText) as PlaybackResponse;
  if (!parsed || typeof parsed !== "object" || typeof parsed.asset !== "object") {
    throw new Error("catalog playback response is invalid");
  }
  return parsed;
}

export function extractBoostContextFromPlayback(
  assetId: string,
  playback: PlaybackResponse
): BoostContext {
  if (playback.asset.asset_id !== assetId) {
    throw new Error("catalog playback asset mismatch");
  }
  const pay = playback.asset.pay;
  if (!pay) {
    throw new Error("catalog playback pay hints missing");
  }
  const fapPayeeId = pay.fap_payee_id?.trim() ?? "";
  const payeeId = pay.payee_id?.trim() ?? "";
  const fapUrlRaw = pay.fap_url?.trim() ?? "";

  if (!fapPayeeId || !payeeId || !fapUrlRaw) {
    throw new Error("catalog playback pay hints incomplete");
  }
  let fapUrl: URL;
  try {
    fapUrl = new URL(fapUrlRaw);
  } catch {
    throw new Error("catalog playback fap_url is invalid");
  }
  if (fapUrl.protocol !== "http:" && fapUrl.protocol !== "https:") {
    throw new Error("catalog playback fap_url must be http/https");
  }
  fapUrl.search = "";
  fapUrl.hash = "";
  return {
    assetId,
    fapUrl: fapUrl.toString().replace(/\/$/, ""),
    fapPayeeId,
    payeeId
  };
}

export function resolveReachableFapUrl(catalogFapUrl: string, configuredFapBaseUrl: string): string {
  const catalogURL = parseHTTPURL("catalog fap_url", catalogFapUrl.trim());
  const configuredURL = parseHTTPURL("configured FAP_BASE_URL", configuredFapBaseUrl.trim());

  catalogURL.search = "";
  catalogURL.hash = "";
  configuredURL.search = "";
  configuredURL.hash = "";

  if (isLoopbackHost(catalogURL.hostname)) {
    return configuredURL.toString().replace(/\/$/, "");
  }
  return catalogURL.toString().replace(/\/$/, "");
}

export async function fetchTextWithTimeout(
  url: string,
  timeoutMs: number,
  init?: RequestInit
): Promise<{ status: number; text: string; contentType: string }> {
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
      contentType: response.headers.get("content-type") ?? "application/json"
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchBoostContextFromCatalog(assetId: string): Promise<BoostContext> {
  const result = await fetchCatalogGET(`/v1/playback/${encodeURIComponent(assetId)}`, boostRequestTimeoutMs);
  if (result.status !== 200) {
    throw new Error(result.text || `failed to fetch playback (${result.status})`);
  }
  const playback = parsePlaybackResponse(result.text);
  return extractBoostContextFromPlayback(assetId, playback);
}
import { fetchCatalogGET } from "@/lib/catalogServer";

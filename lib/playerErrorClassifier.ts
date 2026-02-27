import type { ErrorData } from "hls.js";
import type { PlayerError } from "./playerTypes";

const keyDetails = new Set(["KEY_LOAD_ERROR", "KEY_LOAD_TIMEOUT"]);
const fragmentDetails = new Set(["FRAG_LOAD_ERROR", "FRAG_LOAD_TIMEOUT", "FRAG_PARSING_ERROR"]);
const manifestDetails = new Set(["MANIFEST_LOAD_ERROR", "MANIFEST_LOAD_TIMEOUT"]);
const mediaDetails = new Set([
  "BUFFER_STALLED_ERROR",
  "BUFFER_SEEK_OVER_HOLE",
  "BUFFER_NUDGE_ON_STALL",
  "BUFFER_APPEND_ERROR",
  "BUFFER_APPENDING_ERROR"
]);

function normalizeDetailCode(details: string): string {
  return details
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^a-zA-Z0-9_]/g, "_")
    .toUpperCase()
    .replace(/TIME_OUT/g, "TIMEOUT");
}

function toRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  return value as Record<string, unknown>;
}

function readNumber(value: unknown, key: string): number | undefined {
  const record = toRecord(value);
  if (!record) {
    return undefined;
  }
  const raw = record[key];
  return typeof raw === "number" ? raw : undefined;
}

function readString(value: unknown, key: string): string | undefined {
  const record = toRecord(value);
  if (!record) {
    return undefined;
  }
  const raw = record[key];
  return typeof raw === "string" && raw.trim() !== "" ? raw : undefined;
}

function extractResponseCode(data: ErrorData): number | undefined {
  const code = readNumber(data.response, "code");
  if (typeof code === "number") {
    return code;
  }
  const status = readNumber(data.response, "status");
  if (typeof status === "number") {
    return status;
  }
  const contextStatus = readNumber(data.context, "status");
  return typeof contextStatus === "number" ? contextStatus : undefined;
}

function extractRawUrl(data: ErrorData): string | undefined {
  const dataUrl = readString(data, "url");
  if (dataUrl) {
    return dataUrl;
  }
  const responseUrl = readString(data.response, "url");
  if (responseUrl) {
    return responseUrl;
  }
  const contextUrl = readString(data.context, "url");
  return contextUrl;
}

export function sanitizeUrl(rawUrl: string | undefined): string | undefined {
  if (!rawUrl) {
    return undefined;
  }
  try {
    const parsed = new URL(rawUrl);
    parsed.searchParams.delete("token");
    parsed.searchParams.delete("access_token");
    parsed.searchParams.delete("authorization");
    return parsed.toString();
  } catch {
    return undefined;
  }
}

export function classifyHlsError(args: {
  data: ErrorData;
  providerId: string;
  now?: number;
}): PlayerError {
  const { data, providerId, now } = args;
  const details = String(data.details ?? "unknown_details");
  const detailsUpper = normalizeDetailCode(details);
  const type = String(data.type ?? "unknown_type");
  const fatal = Boolean(data.fatal);
  const responseCode = extractResponseCode(data);
  const url = sanitizeUrl(extractRawUrl(data));
  const timestamp = typeof now === "number" ? now : Date.now();

  if (keyDetails.has(detailsUpper)) {
    return {
      kind: "key",
      type,
      details,
      fatal,
      responseCode,
      url,
      providerId,
      timestamp
    };
  }

  if (fragmentDetails.has(detailsUpper)) {
    return {
      kind: "fragment",
      type,
      details,
      fatal,
      responseCode,
      url,
      providerId,
      timestamp
    };
  }

  if (manifestDetails.has(detailsUpper)) {
    return {
      kind: "manifest",
      type,
      details,
      fatal,
      responseCode,
      url,
      providerId,
      timestamp
    };
  }

  if (mediaDetails.has(detailsUpper)) {
    return {
      kind: "media",
      type,
      details,
      fatal,
      responseCode,
      url,
      providerId,
      timestamp
    };
  }

  return {
    kind: "other",
    type,
    details,
    fatal,
    responseCode,
    url,
    providerId,
    timestamp
  };
}

export function isUnauthorizedKeyError(error: PlayerError): boolean {
  if (error.kind === "key" && error.responseCode === 401) {
    return true;
  }
  if (error.responseCode !== 401) {
    return false;
  }
  const url = error.url ?? "";
  return url.includes("/hls/") && url.includes("/key");
}

import type {
  AccessChallengeStartResponse,
  AccessDevStartResponse,
  AccessTokenExchangeResponse,
  PlaybackResponse
} from "./types";

const challengeIdPattern = /^[a-zA-Z0-9_-]{1,128}$/;

function parseJSONRecord(payloadText: string): Record<string, unknown> {
  const parsed = JSON.parse(payloadText) as unknown;
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("upstream payload is invalid");
  }
  return parsed as Record<string, unknown>;
}

export function parseErrorMessage(payloadText: string): string {
  const trimmed = payloadText.trim();
  if (!trimmed) {
    return "";
  }
  try {
    const parsed = parseJSONRecord(trimmed);
    if (typeof parsed.error === "string") {
      return parsed.error;
    }
    if (typeof parsed.message === "string") {
      return parsed.message;
    }
    if (typeof parsed.error === "object" && parsed.error !== null) {
      const nested = parsed.error as Record<string, unknown>;
      if (typeof nested.message === "string") {
        return nested.message;
      }
      if (typeof nested.code === "string") {
        return nested.code;
      }
    }
  } catch {
    return trimmed;
  }
  return trimmed;
}

export function parseChallengeId(value: string): string {
  const trimmed = value.trim();
  if (!challengeIdPattern.test(trimmed)) {
    throw new Error("challengeId is invalid");
  }
  return trimmed;
}

export function buildAccessSubject(assetId: string): string {
  return `web:${assetId}`;
}

export function isDevModeDisabledResponse(status: number, payloadText: string): boolean {
  if (status !== 403) {
    return false;
  }
  const message = parseErrorMessage(payloadText).toLowerCase();
  return message.includes("dev_mode_disabled");
}

export function shouldFallbackToChallengeFlow(status: number, payloadText: string): boolean {
  if (isDevModeDisabledResponse(status, payloadText)) {
    return true;
  }
  const message = parseErrorMessage(payloadText).toLowerCase();
  if (!message) {
    return false;
  }
  // Some deployments still return "not found: asset" on /v1/access/{assetId}
  // even though challenge flow can proceed catalog-driven.
  return message.includes("not found: asset") || message.includes("asset not found");
}

export function isPayeeNotFoundResponse(status: number, payloadText: string): boolean {
  if (status < 400 || status >= 500) {
    return false;
  }
  const message = parseErrorMessage(payloadText).toLowerCase();
  return message.includes("not found: payee") || message.includes("payee not found");
}

export function parseDevAccessResponse(payloadText: string): AccessDevStartResponse {
  const parsed = parseJSONRecord(payloadText);
  const assetID = typeof parsed.asset_id === "string" ? parsed.asset_id.trim() : "";
  const accessToken = typeof parsed.access_token === "string" ? parsed.access_token.trim() : "";
  const expiresAtRaw = parsed.expires_at;
  const expiresAt =
    typeof expiresAtRaw === "number" && Number.isFinite(expiresAtRaw)
      ? Math.trunc(expiresAtRaw)
      : Number.NaN;

  if (!assetID || !accessToken || !Number.isFinite(expiresAt) || expiresAt <= 0) {
    throw new Error("dev access response is invalid");
  }

  return {
    mode: "dev",
    asset_id: assetID,
    access_token: accessToken,
    expires_at: expiresAt
  };
}

export function parseChallengeStartResponse(payloadText: string): AccessChallengeStartResponse {
  const parsed = parseJSONRecord(payloadText);
  const challengeID =
    typeof parsed.challenge_id === "string"
      ? parsed.challenge_id.trim()
      : typeof parsed.intent_id === "string"
        ? parsed.intent_id.trim()
        : "";
  const bolt11 = typeof parsed.bolt11 === "string" ? parsed.bolt11.trim() : "";
  const expiresAtRaw = parsed.expires_at;
  const expiresAt =
    typeof expiresAtRaw === "number" && Number.isFinite(expiresAtRaw)
      ? Math.trunc(expiresAtRaw)
      : Number.NaN;
  const amountMSatRaw = parsed.amount_msat;
  const amountMSat =
    typeof amountMSatRaw === "number" && Number.isFinite(amountMSatRaw)
      ? Math.trunc(amountMSatRaw)
      : Number.NaN;

  if (
    !challengeID ||
    !challengeIdPattern.test(challengeID) ||
    !bolt11 ||
    !Number.isFinite(expiresAt) ||
    expiresAt <= 0 ||
    !Number.isFinite(amountMSat) ||
    amountMSat <= 0
  ) {
    throw new Error("challenge response is invalid");
  }

  return {
    mode: "invoice",
    challenge_id: challengeID,
    bolt11,
    expires_at: expiresAt,
    amount_msat: amountMSat
  };
}

export function parseTokenExchangeSuccess(payloadText: string): AccessTokenExchangeResponse {
  const parsed = parseJSONRecord(payloadText);
  const accessToken =
    typeof parsed.token === "string"
      ? parsed.token.trim()
      : typeof parsed.access_token === "string"
        ? parsed.access_token.trim()
        : "";
  const resourceID = typeof parsed.resource_id === "string" ? parsed.resource_id.trim() : "";
  const expiresAtRaw = parsed.expires_at;
  const expiresAt =
    typeof expiresAtRaw === "number" && Number.isFinite(expiresAtRaw)
      ? Math.trunc(expiresAtRaw)
      : Number.NaN;

  if (!accessToken || !resourceID || !Number.isFinite(expiresAt) || expiresAt <= 0) {
    throw new Error("token response is invalid");
  }

  return {
    status: "paid",
    access_token: accessToken,
    expires_at: expiresAt,
    resource_id: resourceID
  };
}

export function classifyTokenExchangeConflict(payloadText: string): AccessTokenExchangeResponse {
  const message = parseErrorMessage(payloadText).toLowerCase();
  if (message.includes("payment not settled")) {
    return {
      status: "pending"
    };
  }
  if (message.includes("intent expired") || message.includes("challenge expired")) {
    return {
      status: "expired",
      error: message.includes("challenge") ? "challenge expired" : "intent expired"
    };
  }
  return {
    status: "failed",
    error: parseErrorMessage(payloadText) || "token exchange failed"
  };
}

export function extractAccessFapURL(assetId: string, playback: PlaybackResponse): string {
  if (playback.asset.asset_id !== assetId) {
    throw new Error("catalog playback asset mismatch");
  }
  const fapURLRaw = playback.asset.pay?.fap_url?.trim() ?? "";
  if (!fapURLRaw) {
    throw new Error("catalog playback pay hints missing");
  }
  let parsed: URL;
  try {
    parsed = new URL(fapURLRaw);
  } catch {
    throw new Error("catalog playback fap_url is invalid");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("catalog playback fap_url must be http/https");
  }
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString().replace(/\/$/, "");
}

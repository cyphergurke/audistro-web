const idPattern = /^[a-zA-Z0-9_-]{1,128}$/;
const defaultAllowedLNBitsBaseUrls = [
  "http://lnbits:5000",
  "http://localhost:5000",
  "http://localhost:18085",
  "http://localhost:18090"
];

export function isDevAdminEnabled(): boolean {
  return process.env.NODE_ENV === "development" && process.env.NEXT_PUBLIC_DEV_ADMIN === "true";
}

export function assertDevAdminEnabled(): void {
  if (!isDevAdminEnabled()) {
    throw new Error("dev_admin_disabled");
  }
}

export function parseAdminID(name: string, rawValue: string): string {
  const value = rawValue.trim();
  if (!idPattern.test(value)) {
    throw new Error(`${name} is invalid`);
  }
  return value;
}

export function parseOptionalAdminID(name: string, rawValue: string | null | undefined): string | null {
  if (typeof rawValue !== "string") {
    return null;
  }
  const value = rawValue.trim();
  if (!value) {
    return null;
  }
  if (!idPattern.test(value)) {
    throw new Error(`${name} is invalid`);
  }
  return value;
}

function normalizeBaseURL(name: string, value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value.trim());
  } catch {
    throw new Error(`${name} is not a valid URL`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`${name} must use http/https`);
  }
  parsed.pathname = "/";
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString().replace(/\/$/, "");
}

function isAllowedHost(value: string): boolean {
  const parsed = new URL(value);
  if (parsed.protocol !== "http:") {
    return false;
  }
  if (parsed.hostname === "lnbits" && parsed.port === "5000") {
    return true;
  }
  if (parsed.hostname === "localhost" && parsed.port !== "") {
    return true;
  }
  return false;
}

export function getAllowedLNBitsBaseUrls(): string[] {
  const raw = process.env.DEV_ADMIN_ALLOW_LNBITS_BASE_URLS?.trim() ?? "";
  const values = raw
    ? raw.split(",").map((value) => value.trim()).filter(Boolean)
    : defaultAllowedLNBitsBaseUrls;

  const normalized = values.map((value) => normalizeBaseURL("lnbits_base_url", value));
  return Array.from(new Set(normalized));
}

export function validateLNBitsBaseUrl(rawValue: string): string {
  const normalized = normalizeBaseURL("lnbits_base_url", rawValue);
  if (!isAllowedHost(normalized)) {
    throw new Error("lnbits_base_url host is not allowed");
  }

  const allowed = new Set(getAllowedLNBitsBaseUrls());
  if (!allowed.has(normalized)) {
    throw new Error("lnbits_base_url is not in allowlist");
  }
  return normalized;
}

export function parseHTTPURL(name: string, rawValue: string): string {
  return normalizeBaseURL(name, rawValue);
}

export async function fetchTextWithTimeout(
  url: string,
  timeoutMs: number,
  init?: RequestInit
): Promise<{ status: number; contentType: string; text: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
      cache: "no-store"
    });
    return {
      status: response.status,
      contentType: response.headers.get("content-type") ?? "application/json",
      text: await response.text()
    };
  } finally {
    clearTimeout(timer);
  }
}

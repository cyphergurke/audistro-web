import { getServerEnv } from "@/lib/env";

const defaultCatalogTimeoutMs = 5000;

export type CatalogFetchResult = {
  baseUrl: string;
  url: string;
  status: number;
  text: string;
  contentType: string;
};

export async function fetchCatalogGET(pathname: string, timeoutMs = defaultCatalogTimeoutMs): Promise<CatalogFetchResult> {
  const { catalogBaseUrls } = getServerEnv();

  let lastFailure: CatalogFetchResult | null = null;
  let lastError: Error | null = null;

  for (const baseUrl of catalogBaseUrls) {
    const url = new URL(pathname, baseUrl).toString();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const upstream = await fetch(url, {
        method: "GET",
        cache: "no-store",
        signal: controller.signal
      });
      const result: CatalogFetchResult = {
        baseUrl,
        url,
        status: upstream.status,
        text: await upstream.text(),
        contentType: upstream.headers.get("content-type") ?? "application/json"
      };
      if (result.status >= 200 && result.status < 300) {
        return result;
      }
      lastFailure = result;
    } catch (error: unknown) {
      lastError = error instanceof Error ? error : new Error("catalog GET failed");
    } finally {
      clearTimeout(timeout);
    }
  }

  if (lastFailure) {
    return lastFailure;
  }
  throw lastError ?? new Error("catalog GET failed");
}

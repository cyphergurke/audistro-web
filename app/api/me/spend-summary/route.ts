import { getServerEnv } from "@/lib/env";
import {
  aggregatePaidEntries,
  buildTopAssets,
  buildTopPayees,
  fetchTextWithTimeout,
  hashCookieForCache,
  ledgerRequestTimeoutMs,
  parseAssetLookupLabel,
  parseErrorMessage,
  parseLedgerListResponse,
  resolveTimeWindow,
  spendSummaryMaxPages,
  spendSummaryTopLimit
} from "@/lib/ledger";
import type { AssetLabel } from "@/lib/ledger";
import type { LedgerEntry, SpendSummaryResponse } from "@/lib/types";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const maxQueryLength = 4096;
const defaultWindowSeconds = 30 * 24 * 60 * 60;
const summaryCacheTTLMS = 10_000;
const maxLedgerPageLimit = 100;

type CachedSummary = {
  expiresAt: number;
  payload: SpendSummaryResponse;
};

const spendSummaryCache = new Map<string, CachedSummary>();

function buildCacheKey(cookieHeader: string, from: number, to: number): string {
  return `${hashCookieForCache(cookieHeader)}:${from}:${to}`;
}

function readSummaryFromCache(key: string): SpendSummaryResponse | null {
  const cached = spendSummaryCache.get(key);
  if (!cached) {
    return null;
  }
  if (cached.expiresAt <= Date.now()) {
    spendSummaryCache.delete(key);
    return null;
  }
  return cached.payload;
}

function writeSummaryCache(key: string, payload: SpendSummaryResponse): void {
  spendSummaryCache.set(key, {
    expiresAt: Date.now() + summaryCacheTTLMS,
    payload
  });
}

function topAssetIDsByAmount(items: Map<string, number>): string[] {
  return [...items.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, spendSummaryTopLimit)
    .map(([assetID]) => assetID);
}

async function loadAssetLabels(
  catalogBaseURL: string,
  assetIDs: string[]
): Promise<Map<string, AssetLabel>> {
  const labels = new Map<string, AssetLabel>();
  await Promise.all(
    assetIDs.map(async (assetID) => {
      const upstreamURL = new URL(`/v1/assets/${encodeURIComponent(assetID)}`, catalogBaseURL);
      const upstream = await fetchTextWithTimeout(upstreamURL.toString(), ledgerRequestTimeoutMs, {
        method: "GET"
      });
      if (upstream.status !== 200) {
        return;
      }
      try {
        const parsed = parseAssetLookupLabel(upstream.text);
        labels.set(assetID, parsed);
      } catch {
        // Ignore unknown asset payloads and keep ID-only fallback.
      }
    })
  );
  return labels;
}

function derivePayeeArtistLabels(
  items: LedgerEntry[],
  assetLabels: Map<string, AssetLabel>
): Map<string, { artist_handle?: string; artist_display_name?: string }> {
  const labels = new Map<string, { artist_handle?: string; artist_display_name?: string }>();
  for (const item of items) {
    if (item.status !== "paid" || !item.asset_id) {
      continue;
    }
    if (labels.has(item.payee_id)) {
      continue;
    }
    const assetLabel = assetLabels.get(item.asset_id);
    if (!assetLabel) {
      continue;
    }
    labels.set(item.payee_id, {
      artist_handle: assetLabel.artist_handle,
      artist_display_name: assetLabel.artist_display_name
    });
  }
  return labels;
}

export async function GET(req: Request): Promise<Response> {
  try {
    const requestURL = new URL(req.url);
    if (requestURL.search.length > maxQueryLength) {
      throw new Error("query string is too long");
    }

    const window = resolveTimeWindow(
      requestURL.searchParams.get("from"),
      requestURL.searchParams.get("to"),
      defaultWindowSeconds
    );
    const inboundCookie = req.headers.get("cookie") ?? "";
    const cacheKey = buildCacheKey(inboundCookie, window.from, window.to);
    const cached = readSummaryFromCache(cacheKey);
    if (cached) {
      return NextResponse.json(cached, {
        status: 200,
        headers: {
          "Cache-Control": "no-store"
        }
      });
    }

    const { catalogBaseUrl, fapBaseUrl } = getServerEnv();
    const collectedItems: LedgerEntry[] = [];
    let cursor: string | null = null;
    let latestSetCookie: string | null = null;

    for (let page = 0; page < spendSummaryMaxPages; page += 1) {
      const upstreamURL = new URL("/v1/ledger", fapBaseUrl);
      upstreamURL.searchParams.set("status", "paid");
      upstreamURL.searchParams.set("limit", String(maxLedgerPageLimit));
      if (cursor) {
        upstreamURL.searchParams.set("cursor", cursor);
      }

      const upstream = await fetchTextWithTimeout(upstreamURL.toString(), ledgerRequestTimeoutMs, {
        method: "GET",
        headers: {
          cookie: inboundCookie
        }
      });
      if (upstream.setCookie) {
        latestSetCookie = upstream.setCookie;
      }
      if (upstream.status !== 200) {
        const message = parseErrorMessage(upstream.text) || "failed to load ledger";
        const response = NextResponse.json({ error: message }, { status: upstream.status });
        if (latestSetCookie) {
          response.headers.set("set-cookie", latestSetCookie);
        }
        return response;
      }

      const parsed = parseLedgerListResponse(upstream.text);
      if (parsed.items.length === 0) {
        break;
      }

      let oldestCreatedAt = Number.MAX_SAFE_INTEGER;
      for (const item of parsed.items) {
        oldestCreatedAt = Math.min(oldestCreatedAt, item.created_at);
        if (item.created_at >= window.from && item.created_at <= window.to) {
          collectedItems.push(item);
        }
      }

      if (!parsed.next_cursor || oldestCreatedAt < window.from) {
        break;
      }
      cursor = parsed.next_cursor;
    }

    const aggregation = aggregatePaidEntries(collectedItems);
    const topAssetIDs = topAssetIDsByAmount(aggregation.byAssetID);
    const assetLabels = await loadAssetLabels(catalogBaseUrl, topAssetIDs);
    const payeeArtistLabels = derivePayeeArtistLabels(collectedItems, assetLabels);

    const payload: SpendSummaryResponse = {
      from: window.from,
      to: window.to,
      totals: aggregation.totals,
      top_assets: buildTopAssets(aggregation.byAssetID, assetLabels),
      top_payees: buildTopPayees(aggregation.byPayeeID, payeeArtistLabels),
      items_count: aggregation.paidItemsCount
    };
    writeSummaryCache(cacheKey, payload);

    const response = NextResponse.json(payload, {
      status: 200,
      headers: {
        "Cache-Control": "no-store"
      }
    });
    if (latestSetCookie) {
      response.headers.set("set-cookie", latestSetCookie);
    }
    return response;
  } catch (err: unknown) {
    if (err instanceof Error) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    return NextResponse.json({ error: "spend summary route failed" }, { status: 500 });
  }
}

import { getServerEnv } from "@/lib/env";
import {
  fetchTextWithTimeout,
  filterEntriesByWindow,
  hashCookieForCache,
  ledgerRequestTimeoutMs,
  parseFromDays,
  parseErrorMessage,
  parseLedgerListResponse,
  parsePlaybackLabel,
  resolveWindowTimestamps,
  spendSummaryMaxPages,
  spendSummaryTopLimit
} from "@/lib/ledger";
import type { LedgerEntry, SpendSummaryResponse } from "@/lib/types";
import { aggregateSpend, topN } from "@/lib/spendAggregation";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const maxQueryLength = 4096;
const summaryCacheTTLMS = 10_000;
const maxLedgerPageLimit = 100;

type CachedSummary = {
  expiresAt: number;
  payload: SpendSummaryResponse;
};

const spendSummaryCache = new Map<string, CachedSummary>();

function buildCacheKey(cookieHeader: string, windowDays: 7 | 30): string {
  return `${hashCookieForCache(cookieHeader)}:${windowDays}`;
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

async function loadAssetLabels(
  catalogBaseURL: string,
  assetIDs: string[]
): Promise<Map<string, { title?: string; artist?: string }>> {
  const labels = new Map<string, { title?: string; artist?: string }>();
  await Promise.all(
    assetIDs.map(async (assetID) => {
      const upstreamURL = new URL(`/v1/playback/${encodeURIComponent(assetID)}`, catalogBaseURL);
      const upstream = await fetchTextWithTimeout(upstreamURL.toString(), ledgerRequestTimeoutMs, {
        method: "GET"
      });
      if (upstream.status !== 200) {
        return;
      }
      try {
        const parsed = parsePlaybackLabel(upstream.text, assetID);
        labels.set(assetID, {
          title: parsed.title,
          artist: parsed.artist
        });
      } catch {
        // Keep unknown label.
      }
    })
  );
  return labels;
}

export async function GET(req: Request): Promise<Response> {
  try {
    const requestURL = new URL(req.url);
    if (requestURL.search.length > maxQueryLength) {
      throw new Error("query string is too long");
    }

    const windowDays = parseFromDays(requestURL.searchParams.get("fromDays"));
    const window = resolveWindowTimestamps(windowDays);
    const inboundCookie = req.headers.get("cookie") ?? "";
    const cacheKey = buildCacheKey(inboundCookie, windowDays);
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
    let truncated = false;

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

      const windowedItems = filterEntriesByWindow(parsed.items, window.from, window.to);
      collectedItems.push(...windowedItems);

      let oldestCreatedAt = Number.MAX_SAFE_INTEGER;
      for (const item of parsed.items) {
        oldestCreatedAt = Math.min(oldestCreatedAt, item.created_at);
      }

      if (!parsed.next_cursor || oldestCreatedAt < window.from) {
        break;
      }
      cursor = parsed.next_cursor;
      if (page === spendSummaryMaxPages - 1) {
        truncated = true;
      }
    }

    const aggregation = aggregateSpend(collectedItems);
    const topAssetIDs = topN(aggregation.by_asset_id, spendSummaryTopLimit).map((entry) => entry.key);
    const assetLabels = await loadAssetLabels(catalogBaseUrl, topAssetIDs);

    const topAssets = topN(aggregation.by_asset_id, spendSummaryTopLimit).map((entry) => {
      const label = assetLabels.get(entry.key);
      return {
        asset_id: entry.key,
        title: label?.title ?? "Unknown asset",
        artist: label?.artist ?? "unknown",
        amount_msat: entry.amount_msat
      };
    });

    const topPayees = topN(aggregation.by_payee_id, spendSummaryTopLimit).map((entry) => ({
      payee_id: entry.key,
      amount_msat: entry.amount_msat
    }));

    const payload: SpendSummaryResponse = {
      window_days: windowDays,
      totals: aggregation.totals,
      top_assets: topAssets,
      top_payees: topPayees,
      items_count: aggregation.paid_items_count,
      truncated
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

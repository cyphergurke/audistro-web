import { fetchCatalogGET } from "@/lib/catalogServer";
import { getServerEnv } from "@/lib/env";
import {
  aggregatePaidEntries,
  buildTopAssets,
  buildTopPayees,
  hashCookieForCache,
  parseLedgerListResponse,
  parseErrorMessage,
  resolveTimeWindow,
  spendSummaryMaxPages,
  spendSummaryTopLimit
} from "@/lib/ledger";
import type { AssetLabel } from "@/lib/ledger";
import type { LedgerEntry, SpendSummaryResponse } from "@/lib/types";
import { APIClientError, createAPIClient } from "@/src/lib/apiClient";
import type { paths as FAPPaths } from "@/src/gen/fap";
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

type CatalogAssetLookupResponse = {
  asset?: {
    title?: string;
  };
  artist?: {
    handle?: string;
    display_name?: string;
  };
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

async function loadAssetLabels(assetIDs: string[]): Promise<Map<string, AssetLabel>> {
  const labels = new Map<string, AssetLabel>();
  await Promise.all(
    assetIDs.map(async (assetID) => {
      try {
        const upstream = await fetchCatalogGET(`/v1/assets/${encodeURIComponent(assetID)}`);
        if (upstream.status !== 200) {
          return;
        }
        const parsed = JSON.parse(upstream.text) as CatalogAssetLookupResponse;
        labels.set(assetID, {
          asset_id: assetID,
          title: parsed.asset?.title,
          artist_handle: parsed.artist?.handle,
          artist_display_name: parsed.artist?.display_name
        });
      } catch {
        return;
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

    const { fapBaseUrl } = getServerEnv();
    const fapClient = createAPIClient<FAPPaths>(fapBaseUrl);
    const collectedItems: LedgerEntry[] = [];
    let cursor: string | null = null;
    let latestSetCookie: string | null = null;

    for (let page = 0; page < spendSummaryMaxPages; page += 1) {
      let parsed: FAPPaths["/v1/ledger"]["get"]["responses"][200]["content"]["application/json"];
      try {
        const upstream = await fapClient.requestJSON({
          method: "get",
          path: "/v1/ledger",
          cookie: inboundCookie,
          query: {
            status: "paid",
            limit: maxLedgerPageLimit,
            cursor: cursor ?? undefined
          }
        });
        parsed = upstream.data;
        if (upstream.setCookie) {
          latestSetCookie = upstream.setCookie;
        }
      } catch (error: unknown) {
        if (!(error instanceof APIClientError)) {
          throw error;
        }
        const message = parseErrorMessage(error.bodyText) || "failed to load ledger";
        const response = NextResponse.json({ error: message }, { status: error.status });
        if (error.setCookie ?? latestSetCookie) {
          response.headers.set("set-cookie", error.setCookie ?? latestSetCookie ?? "");
        }
        return response;
      }
      const normalizedResponse = parseLedgerListResponse(JSON.stringify(parsed));
      if (normalizedResponse.items.length === 0) {
        break;
      }

      let oldestCreatedAt = Number.MAX_SAFE_INTEGER;
      for (const item of normalizedResponse.items) {
        oldestCreatedAt = Math.min(oldestCreatedAt, item.created_at);
        if (item.created_at >= window.from && item.created_at <= window.to) {
          collectedItems.push(item);
        }
      }

      if (!normalizedResponse.next_cursor || oldestCreatedAt < window.from) {
        break;
      }
      cursor = normalizedResponse.next_cursor;
    }

    const aggregation = aggregatePaidEntries(collectedItems);
    const topAssetIDs = topAssetIDsByAmount(aggregation.byAssetID);
    const assetLabels = await loadAssetLabels(topAssetIDs);
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

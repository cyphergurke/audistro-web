import {
  boostRequestTimeoutMs,
  fetchBoostContextFromCatalog,
  fetchTextWithTimeout,
  parseAssetId,
  parseBoostListCursor,
  parseBoostListLimit,
  parseBoostListStatus,
  resolveReachableFapUrl
} from "@/lib/boostServer";
import { getServerEnv } from "@/lib/env";

export const dynamic = "force-dynamic";

const maxQueryLength = 2048;

export async function GET(req: Request): Promise<Response> {
  try {
    const requestUrl = new URL(req.url);
    if (requestUrl.search.length > maxQueryLength) {
      throw new Error("query string is too long");
    }

    const assetId = parseAssetId(requestUrl.searchParams.get("assetId") ?? "");
    const limit = parseBoostListLimit(requestUrl.searchParams.get("limit"));
    const cursor = parseBoostListCursor(requestUrl.searchParams.get("cursor"));
    const status = parseBoostListStatus(requestUrl.searchParams.get("status"));

    const { catalogBaseUrl, fapBaseUrl } = getServerEnv();
    const boostContext = await fetchBoostContextFromCatalog(catalogBaseUrl, assetId);
    const reachableFapUrl = resolveReachableFapUrl(boostContext.fapUrl, fapBaseUrl);

    const upstreamUrl = new URL("/v1/boost", reachableFapUrl);
    upstreamUrl.searchParams.set("asset_id", assetId);
    upstreamUrl.searchParams.set("payee_id", boostContext.fapPayeeId);
    upstreamUrl.searchParams.set("limit", String(limit));
    if (cursor) {
      upstreamUrl.searchParams.set("cursor", cursor);
    }
    if (status) {
      upstreamUrl.searchParams.set("status", status);
    }

    const upstream = await fetchTextWithTimeout(upstreamUrl.toString(), boostRequestTimeoutMs, {
      method: "GET"
    });

    return new Response(upstream.text, {
      status: upstream.status,
      headers: {
        "Content-Type": upstream.contentType,
        "Cache-Control": "no-store"
      }
    });
  } catch (err: unknown) {
    if (err instanceof Error) {
      return Response.json({ error: err.message }, { status: 400 });
    }
    return Response.json({ error: "boost list route failed" }, { status: 500 });
  }
}

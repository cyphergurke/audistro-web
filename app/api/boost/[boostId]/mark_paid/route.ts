import {
  boostRequestTimeoutMs,
  fetchBoostContextFromCatalog,
  fetchTextWithTimeout,
  parseAssetId,
  parseBoostId,
  resolveReachableFapUrl
} from "@/lib/boostServer";
import { getServerEnv } from "@/lib/env";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{
    boostId: string;
  }>;
};

const maxQueryLength = 1024;

export async function POST(req: Request, { params }: RouteContext): Promise<Response> {
  try {
    if (process.env.NEXT_PUBLIC_DEV_MODE !== "true" && process.env.NODE_ENV === "production") {
      return Response.json({ error: "dev_mode_disabled" }, { status: 403 });
    }

    const { boostId: rawBoostId } = await params;
    const boostId = parseBoostId(rawBoostId);
    const requestUrl = new URL(req.url);
    if (requestUrl.search.length > maxQueryLength) {
      throw new Error("query string is too long");
    }
    const assetId = parseAssetId(requestUrl.searchParams.get("assetId") ?? "");
    const { fapBaseUrl } = getServerEnv();
    const boostContext = await fetchBoostContextFromCatalog(assetId);
    const reachableFapUrl = resolveReachableFapUrl(boostContext.fapUrl, fapBaseUrl);

    const upstreamUrl = new URL(
      `/v1/boost/${encodeURIComponent(boostId)}/mark_paid`,
      reachableFapUrl
    );
    const upstream = await fetchTextWithTimeout(upstreamUrl.toString(), boostRequestTimeoutMs, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: "{}"
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
    return Response.json({ error: "boost mark_paid route failed" }, { status: 500 });
  }
}

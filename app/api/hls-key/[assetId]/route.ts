import { extractAccessFapURL } from "@/lib/accessServer";
import {
  APIClientError,
  createAPIClient
} from "@/src/lib/apiClient";
import type { paths as CatalogPaths } from "@/src/gen/catalog";
import type { paths as FAPPaths } from "@/src/gen/fap";
import {
  boostRequestTimeoutMs,
  parseAssetId,
  resolveReachableFapUrl
} from "@/lib/boostServer";
import { getServerEnv } from "@/lib/env";
import type { PlaybackResponse } from "@/lib/types";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const minTokenLength = 16;
const maxTokenLength = 4096;

type RouteContext = {
  params: Promise<{
    assetId: string;
  }>;
};

function parseToken(rawToken: string): string {
  const trimmed = rawToken.trim();
  if (trimmed.length < minTokenLength || trimmed.length > maxTokenLength) {
    throw new Error("token length is invalid");
  }
  return trimmed;
}

export async function GET(req: Request, { params }: RouteContext): Promise<Response> {
  try {
    const { assetId: rawAssetId } = await params;
    const assetId = parseAssetId(rawAssetId);
    const token = parseToken(new URL(req.url).searchParams.get("token") ?? "");
    const inboundCookie = req.headers.get("cookie") ?? "";
    const { catalogBaseUrl, fapBaseUrl } = getServerEnv();
    const catalogClient = createAPIClient<CatalogPaths>(catalogBaseUrl);
    let playback: PlaybackResponse;
    try {
      const playbackResult = await catalogClient.requestJSON<"get", "/v1/playback/{assetId}", PlaybackResponse>({
        method: "get",
        path: "/v1/playback/{assetId}",
        pathParams: { assetId },
        timeoutMs: boostRequestTimeoutMs
      });
      playback = playbackResult.data;
    } catch (error: unknown) {
      if (error instanceof APIClientError) {
        const response = new Response(error.bodyText, {
          status: error.status,
          headers: {
            "Content-Type": error.contentType || "application/json",
            "Cache-Control": "no-store"
          }
        });
        if (error.setCookie) {
          response.headers.set("set-cookie", error.setCookie);
        }
        return response;
      }
      throw error;
    }
    const catalogFapURL = extractAccessFapURL(assetId, playback);
    const reachableFapBaseURL = resolveReachableFapUrl(catalogFapURL, fapBaseUrl);
    const fapClient = createAPIClient<FAPPaths>(reachableFapBaseURL);

    try {
      const keyResult = await fapClient.requestBinary({
        method: "get",
        path: "/hls/{assetId}/key",
        pathParams: { assetId },
        cookie: inboundCookie,
        timeoutMs: boostRequestTimeoutMs,
        headers: {
          Authorization: `Bearer ${token}`
        }
      });
      const response = new Response(keyResult.data, {
        status: 200,
        headers: {
          "Content-Type": keyResult.response.headers.get("content-type") ?? "application/octet-stream",
          "Cache-Control": "no-store"
        }
      });
      if (keyResult.setCookie) {
        response.headers.set("set-cookie", keyResult.setCookie);
      }
      return response;
    } catch (error: unknown) {
      if (error instanceof APIClientError) {
        const response = new Response(error.bodyText, {
          status: error.status,
          headers: {
            "Content-Type": error.contentType || "application/json",
            "Cache-Control": "no-store"
          }
        });
        if (error.setCookie) {
          response.headers.set("set-cookie", error.setCookie);
        }
        return response;
      }
      throw error;
    }
  } catch (err: unknown) {
    if (err instanceof Error) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    return NextResponse.json({ error: "hls key proxy failed" }, { status: 500 });
  }
}

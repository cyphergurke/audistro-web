import {
  APIClientError,
  createAPIClient
} from "@/src/lib/apiClient";
import type { paths as FAPPaths } from "@/src/gen/fap";
import { fetchCatalogGET } from "@/lib/catalogServer";
import {
  classifyTokenExchangeConflict,
  extractAccessFapURL,
  parseChallengeId
} from "@/lib/accessServer";
import type { PlaybackResponse } from "@/lib/types";
import {
  boostRequestTimeoutMs,
  parseAssetId,
  resolveReachableFapUrl
} from "@/lib/boostServer";
import { getServerEnv } from "@/lib/env";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

type ExchangeTokenBody = {
  assetId?: unknown;
  challengeId?: unknown;
};

export async function POST(req: Request): Promise<Response> {
  try {
    const body = (await req.json()) as ExchangeTokenBody;
    const assetId = parseAssetId(String(body.assetId ?? ""));
    const challengeId = parseChallengeId(String(body.challengeId ?? ""));
    const { fapBaseUrl } = getServerEnv();
    const inboundCookie = req.headers.get("cookie") ?? "";

    let playback: PlaybackResponse;
    try {
      const playbackResult = await fetchCatalogGET(`/v1/playback/${encodeURIComponent(assetId)}`, boostRequestTimeoutMs);
      if (playbackResult.status !== 200) {
        return new Response(playbackResult.text, {
          status: playbackResult.status,
          headers: {
            "Content-Type": playbackResult.contentType || "application/json",
            "Cache-Control": "no-store"
          }
        });
      }
      playback = JSON.parse(playbackResult.text) as PlaybackResponse;
    } catch (error: unknown) {
      throw error;
    }

    const catalogFapURL = extractAccessFapURL(assetId, playback);
    const reachableFapBaseURL = resolveReachableFapUrl(catalogFapURL, fapBaseUrl);
    const fapClient = createAPIClient<FAPPaths>(reachableFapBaseURL);

    try {
      const tokenResult = await fapClient.requestJSON({
        method: "post",
        path: "/v1/fap/token",
        cookie: inboundCookie,
        timeoutMs: boostRequestTimeoutMs,
        json: {
          challenge_id: challengeId
        }
      });
      const paid = {
        status: "paid" as const,
        access_token: tokenResult.data.token,
        expires_at: tokenResult.data.expires_at,
        resource_id: tokenResult.data.resource_id
      };
      const response = NextResponse.json(paid, {
        status: 200,
        headers: {
          "Cache-Control": "no-store"
        }
      });
      if (tokenResult.setCookie) {
        response.headers.set("set-cookie", tokenResult.setCookie);
      }
      return response;
    } catch (error: unknown) {
      if (!(error instanceof APIClientError)) {
        throw error;
      }
      if (error.status === 409) {
        const classified = classifyTokenExchangeConflict(error.bodyText);
        const response = NextResponse.json(classified, {
          status: 200,
          headers: {
            "Cache-Control": "no-store"
          }
        });
        if (error.setCookie) {
          response.headers.set("set-cookie", error.setCookie);
        }
        return response;
      }

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
  } catch (err: unknown) {
    if (err instanceof Error) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    return NextResponse.json({ error: "access token route failed" }, { status: 500 });
  }
}

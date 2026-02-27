import {
  classifyTokenExchangeConflict,
  extractAccessFapURL,
  parseChallengeId,
  parseTokenExchangeSuccess
} from "@/lib/accessServer";
import {
  boostRequestTimeoutMs,
  parseAssetId,
  parsePlaybackResponse,
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
    const { catalogBaseUrl, fapBaseUrl } = getServerEnv();
    const inboundCookie = req.headers.get("cookie") ?? "";

    const playbackURL = new URL(`/v1/playback/${encodeURIComponent(assetId)}`, catalogBaseUrl).toString();
    const playbackController = new AbortController();
    const playbackTimeout = setTimeout(() => playbackController.abort(), boostRequestTimeoutMs);
    const playbackUpstream = await fetch(playbackURL, {
      method: "GET",
      cache: "no-store",
      signal: playbackController.signal
    });
    clearTimeout(playbackTimeout);
    const playbackText = await playbackUpstream.text();
    const playbackContentType = playbackUpstream.headers.get("content-type") ?? "application/json";
    if (playbackUpstream.status !== 200) {
      return new Response(playbackText, {
        status: playbackUpstream.status,
        headers: {
          "Content-Type": playbackContentType,
          "Cache-Control": "no-store"
        }
      });
    }

    const playback = parsePlaybackResponse(playbackText);
    const catalogFapURL = extractAccessFapURL(assetId, playback);
    const reachableFapBaseURL = resolveReachableFapUrl(catalogFapURL, fapBaseUrl);
    const tokenURL = new URL("/v1/fap/token", reachableFapBaseURL).toString();

    const tokenController = new AbortController();
    const tokenTimeout = setTimeout(() => tokenController.abort(), boostRequestTimeoutMs);
    const tokenUpstream = await fetch(tokenURL, {
      method: "POST",
      cache: "no-store",
      signal: tokenController.signal,
      headers: {
        "Content-Type": "application/json",
        cookie: inboundCookie
      },
      body: JSON.stringify({
        challenge_id: challengeId
      })
    });
    clearTimeout(tokenTimeout);
    const tokenText = await tokenUpstream.text();
    const tokenContentType = tokenUpstream.headers.get("content-type") ?? "application/json";
    const tokenSetCookie = tokenUpstream.headers.get("set-cookie");

    if (tokenUpstream.status === 200) {
      const paid = parseTokenExchangeSuccess(tokenText);
      const response = NextResponse.json(paid, {
        status: 200,
        headers: {
          "Cache-Control": "no-store"
        }
      });
      if (tokenSetCookie) {
        response.headers.set("set-cookie", tokenSetCookie);
      }
      return response;
    }

    if (tokenUpstream.status === 409) {
      const classified = classifyTokenExchangeConflict(tokenText);
      const response = NextResponse.json(classified, {
        status: 200,
        headers: {
          "Cache-Control": "no-store"
        }
      });
      if (tokenSetCookie) {
        response.headers.set("set-cookie", tokenSetCookie);
      }
      return response;
    }

    const response = new Response(tokenText, {
      status: tokenUpstream.status,
      headers: {
        "Content-Type": tokenContentType,
        "Cache-Control": "no-store"
      }
    });
    if (tokenSetCookie) {
      response.headers.set("set-cookie", tokenSetCookie);
    }
    return response;
  } catch (err: unknown) {
    if (err instanceof Error) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    return NextResponse.json({ error: "access token route failed" }, { status: 500 });
  }
}

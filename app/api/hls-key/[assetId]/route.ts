import { extractAccessFapURL } from "@/lib/accessServer";
import {
  boostRequestTimeoutMs,
  parseAssetId,
  parsePlaybackResponse,
  resolveReachableFapUrl
} from "@/lib/boostServer";
import { getServerEnv } from "@/lib/env";
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
    const keyURL = new URL(`/hls/${encodeURIComponent(assetId)}/key`, reachableFapBaseURL).toString();

    const keyController = new AbortController();
    const keyTimeout = setTimeout(() => keyController.abort(), boostRequestTimeoutMs);
    const keyUpstream = await fetch(keyURL, {
      method: "GET",
      cache: "no-store",
      signal: keyController.signal,
      headers: {
        Authorization: `Bearer ${token}`,
        cookie: inboundCookie
      }
    });
    clearTimeout(keyTimeout);
    const setCookie = keyUpstream.headers.get("set-cookie");
    const contentType = keyUpstream.headers.get("content-type") ?? "application/octet-stream";

    if (keyUpstream.status !== 200) {
      const text = await keyUpstream.text();
      const response = new Response(text, {
        status: keyUpstream.status,
        headers: {
          "Content-Type": contentType,
          "Cache-Control": "no-store"
        }
      });
      if (setCookie) {
        response.headers.set("set-cookie", setCookie);
      }
      return response;
    }

    const payload = await keyUpstream.arrayBuffer();
    const response = new Response(payload, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "no-store"
      }
    });
    if (setCookie) {
      response.headers.set("set-cookie", setCookie);
    }
    return response;
  } catch (err: unknown) {
    if (err instanceof Error) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    return NextResponse.json({ error: "hls key proxy failed" }, { status: 500 });
  }
}


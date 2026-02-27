import {
  extractAccessFapURL,
  isPayeeNotFoundResponse,
  shouldFallbackToChallengeFlow,
  parseChallengeStartResponse,
  parseDevAccessResponse
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
const minAccessAmountMsat = 1;
const maxAccessAmountMsat = 50_000_000;
const defaultAccessAmountMsat = 1000;

function resolveAccessAmountMsat(rawValue: unknown): number {
  if (typeof rawValue !== "number" || !Number.isFinite(rawValue)) {
    return defaultAccessAmountMsat;
  }
  const normalized = Math.trunc(rawValue);
  if (normalized < minAccessAmountMsat) {
    return defaultAccessAmountMsat;
  }
  if (normalized > maxAccessAmountMsat) {
    return maxAccessAmountMsat;
  }
  return normalized;
}

type RouteContext = {
  params: Promise<{
    assetId: string;
  }>;
};

type ChallengeAttemptResult = {
  status: number;
  text: string;
  contentType: string;
  setCookie: string | null;
};

async function requestChallenge(args: {
  challengeURL: string;
  inboundCookie: string;
  assetId: string;
  payeeId: string;
  amountMsat: number;
}): Promise<ChallengeAttemptResult> {
  const challengeController = new AbortController();
  const challengeTimeout = setTimeout(() => challengeController.abort(), boostRequestTimeoutMs);
  const challengeUpstream = await fetch(args.challengeURL, {
    method: "POST",
    cache: "no-store",
    signal: challengeController.signal,
    headers: {
      "Content-Type": "application/json",
      cookie: args.inboundCookie
    },
    body: JSON.stringify({
      asset_id: args.assetId,
      payee_id: args.payeeId,
      amount_msat: args.amountMsat
    })
  });
  clearTimeout(challengeTimeout);
  return {
    status: challengeUpstream.status,
    text: await challengeUpstream.text(),
    contentType: challengeUpstream.headers.get("content-type") ?? "application/json",
    setCookie: challengeUpstream.headers.get("set-cookie")
  };
}

export async function POST(req: Request, { params }: RouteContext): Promise<Response> {
  try {
    const { assetId: rawAssetId } = await params;
    const assetId = parseAssetId(rawAssetId);
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

    const devAccessURL = new URL(`/v1/access/${encodeURIComponent(assetId)}`, reachableFapBaseURL).toString();
    const devController = new AbortController();
    const devTimeout = setTimeout(() => devController.abort(), boostRequestTimeoutMs);
    const devAccessUpstream = await fetch(devAccessURL, {
      method: "POST",
      cache: "no-store",
      signal: devController.signal,
      headers: {
        cookie: inboundCookie
      }
    });
    clearTimeout(devTimeout);
    const devText = await devAccessUpstream.text();
    const devContentType = devAccessUpstream.headers.get("content-type") ?? "application/json";
    const devSetCookie = devAccessUpstream.headers.get("set-cookie");
    if (devAccessUpstream.status === 200) {
      const parsedDev = parseDevAccessResponse(devText);
      const response = NextResponse.json(parsedDev, {
        status: 200,
        headers: {
          "Cache-Control": "no-store"
        }
      });
      if (devSetCookie) {
        response.headers.set("set-cookie", devSetCookie);
      }
      return response;
    }
    if (!shouldFallbackToChallengeFlow(devAccessUpstream.status, devText)) {
      const response = new Response(devText, {
        status: devAccessUpstream.status,
        headers: {
          "Content-Type": devContentType,
          "Cache-Control": "no-store"
        }
      });
      if (devSetCookie) {
        response.headers.set("set-cookie", devSetCookie);
      }
      return response;
    }

    const challengeURL = new URL("/v1/fap/challenge", reachableFapBaseURL).toString();
    const amountMsat = resolveAccessAmountMsat(playback.asset.pay?.price_msat);
    const primaryPayeeId = (playback.asset.pay?.fap_payee_id ?? "").trim();
    const secondaryPayeeId = (playback.asset.pay?.payee_id ?? "").trim();
    if (!primaryPayeeId && !secondaryPayeeId) {
      return NextResponse.json({ error: "catalog playback payee hints missing" }, { status: 400 });
    }

    let challengeAttempt = await requestChallenge({
      challengeURL,
      inboundCookie,
      assetId,
      payeeId: primaryPayeeId || secondaryPayeeId,
      amountMsat
    });

    if (
      primaryPayeeId &&
      secondaryPayeeId &&
      primaryPayeeId !== secondaryPayeeId &&
      isPayeeNotFoundResponse(challengeAttempt.status, challengeAttempt.text)
    ) {
      challengeAttempt = await requestChallenge({
        challengeURL,
        inboundCookie,
        assetId,
        payeeId: secondaryPayeeId,
        amountMsat
      });
    }

    if (challengeAttempt.status !== 200) {
      const response = new Response(challengeAttempt.text, {
        status: challengeAttempt.status,
        headers: {
          "Content-Type": challengeAttempt.contentType,
          "Cache-Control": "no-store"
        }
      });
      if (challengeAttempt.setCookie) {
        response.headers.set("set-cookie", challengeAttempt.setCookie);
      }
      return response;
    }

    const parsedChallenge = parseChallengeStartResponse(challengeAttempt.text);
    const response = NextResponse.json(parsedChallenge, {
      status: 200,
      headers: {
        "Cache-Control": "no-store"
      }
    });
    if (challengeAttempt.setCookie) {
      response.headers.set("set-cookie", challengeAttempt.setCookie);
    }
    return response;
  } catch (err: unknown) {
    if (err instanceof Error) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    return NextResponse.json({ error: "access route failed" }, { status: 500 });
  }
}

import {
  APIClientError,
  createAPIClient
} from "@/src/lib/apiClient";
import { fetchCatalogGET } from "@/lib/catalogServer";
import type { components as FAPComponents, paths as FAPPaths } from "@/src/gen/fap";
import {
  extractAccessFapURL,
  isPayeeNotFoundResponse,
  shouldFallbackToChallengeFlow
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
  data?: FAPComponents["schemas"]["ChallengeResponse"];
  error?: APIClientError;
  setCookie: string | null;
};

async function requestChallenge(args: {
  fapBaseURL: string;
  inboundCookie: string;
  assetId: string;
  payeeId: string;
  amountMsat: number;
}): Promise<ChallengeAttemptResult> {
  const fapClient = createAPIClient<FAPPaths>(args.fapBaseURL);
  try {
    const result = await fapClient.requestJSON({
      method: "post",
      path: "/v1/fap/challenge",
      cookie: args.inboundCookie,
      timeoutMs: boostRequestTimeoutMs,
      json: {
        asset_id: args.assetId,
        payee_id: args.payeeId,
        amount_msat: args.amountMsat
      }
    });
    return {
      data: result.data,
      setCookie: result.setCookie
    };
  } catch (error: unknown) {
    if (error instanceof APIClientError) {
      return {
        error,
        setCookie: error.setCookie
      };
    }
    throw error;
  }
}

function proxyAPIError(error: APIClientError): Response {
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

export async function POST(req: Request, { params }: RouteContext): Promise<Response> {
  try {
    const { assetId: rawAssetId } = await params;
    const assetId = parseAssetId(rawAssetId);
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
      const devResult = await fapClient.requestJSON({
        method: "post",
        path: "/v1/access/{assetId}",
        pathParams: { assetId },
        cookie: inboundCookie,
        timeoutMs: boostRequestTimeoutMs
      });
      const parsedDev = {
        mode: "dev" as const,
        asset_id: devResult.data.asset_id,
        access_token: devResult.data.access_token,
        expires_at: devResult.data.expires_at
      };
      const response = NextResponse.json(parsedDev, {
        status: 200,
        headers: {
          "Cache-Control": "no-store"
        }
      });
      if (devResult.setCookie) {
        response.headers.set("set-cookie", devResult.setCookie);
      }
      return response;
    } catch (error: unknown) {
      if (!(error instanceof APIClientError)) {
        throw error;
      }
      if (!shouldFallbackToChallengeFlow(error.status, error.bodyText)) {
        return proxyAPIError(error);
      }
    }

    const amountMsat = resolveAccessAmountMsat(playback.asset.pay?.price_msat);
    const primaryPayeeId = (playback.asset.pay?.fap_payee_id ?? "").trim();
    const secondaryPayeeId = (playback.asset.pay?.payee_id ?? "").trim();
    if (!primaryPayeeId && !secondaryPayeeId) {
      return NextResponse.json({ error: "catalog playback payee hints missing" }, { status: 400 });
    }

    let challengeAttempt = await requestChallenge({
      fapBaseURL: reachableFapBaseURL,
      inboundCookie,
      assetId,
      payeeId: primaryPayeeId || secondaryPayeeId,
      amountMsat
    });

    if (
      primaryPayeeId &&
      secondaryPayeeId &&
      primaryPayeeId !== secondaryPayeeId &&
      challengeAttempt.error &&
      isPayeeNotFoundResponse(challengeAttempt.error.status, challengeAttempt.error.bodyText)
    ) {
      challengeAttempt = await requestChallenge({
        fapBaseURL: reachableFapBaseURL,
        inboundCookie,
        assetId,
        payeeId: secondaryPayeeId,
        amountMsat
      });
    }

    if (!challengeAttempt.data) {
      if (!challengeAttempt.error) {
        throw new Error("challenge request failed");
      }
      return proxyAPIError(challengeAttempt.error);
    }

    const parsedChallenge = {
      mode: "invoice" as const,
      challenge_id: challengeAttempt.data.challenge_id || challengeAttempt.data.intent_id,
      bolt11: challengeAttempt.data.bolt11,
      expires_at: challengeAttempt.data.expires_at,
      amount_msat: challengeAttempt.data.amount_msat
    };
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

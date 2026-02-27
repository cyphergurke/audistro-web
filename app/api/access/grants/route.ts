import { extractAccessFapURL } from "@/lib/accessServer";
import {
  boostRequestTimeoutMs,
  parseAssetId,
  parsePlaybackResponse,
  resolveReachableFapUrl
} from "@/lib/boostServer";
import { getServerEnv } from "@/lib/env";
import type { AccessGrant, AccessGrantsResponse } from "@/lib/types";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

function parseGrantItems(payloadText: string): AccessGrant[] {
  const parsed = JSON.parse(payloadText) as unknown;
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("invalid grants response");
  }
  const itemsRaw = (parsed as { items?: unknown }).items;
  if (!Array.isArray(itemsRaw)) {
    return [];
  }

  const items: AccessGrant[] = [];
  for (const item of itemsRaw) {
    if (typeof item !== "object" || item === null) {
      continue;
    }
    const record = item as Record<string, unknown>;
    const assetID = typeof record.asset_id === "string" ? record.asset_id.trim() : "";
    const status = typeof record.status === "string" ? record.status.trim() : "";
    const minutesPurchased =
      typeof record.minutes_purchased === "number" && Number.isFinite(record.minutes_purchased)
        ? Math.trunc(record.minutes_purchased)
        : Number.NaN;
    const validFrom =
      typeof record.valid_from === "number" && Number.isFinite(record.valid_from)
        ? Math.trunc(record.valid_from)
        : null;
    const validUntil =
      typeof record.valid_until === "number" && Number.isFinite(record.valid_until)
        ? Math.trunc(record.valid_until)
        : null;

    if (assetID === "" || !Number.isFinite(minutesPurchased)) {
      continue;
    }
    if (status !== "active" && status !== "revoked" && status !== "expired") {
      continue;
    }
    const grantStatus = status as AccessGrant["status"];

    items.push({
      asset_id: assetID,
      status: grantStatus,
      valid_from: validFrom,
      valid_until: validUntil,
      minutes_purchased: minutesPurchased
    });
  }

  return items;
}

export async function GET(req: Request): Promise<Response> {
  try {
    const requestURL = new URL(req.url);
    const assetId = parseAssetId(requestURL.searchParams.get("assetId") ?? "");
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
    const grantsURL = new URL("/v1/access/grants", reachableFapBaseURL);
    grantsURL.searchParams.set("asset_id", assetId);

    const grantsController = new AbortController();
    const grantsTimeout = setTimeout(() => grantsController.abort(), boostRequestTimeoutMs);
    const grantsUpstream = await fetch(grantsURL.toString(), {
      method: "GET",
      cache: "no-store",
      signal: grantsController.signal,
      headers: {
        cookie: inboundCookie
      }
    });
    clearTimeout(grantsTimeout);

    const grantsText = await grantsUpstream.text();
    const grantsContentType = grantsUpstream.headers.get("content-type") ?? "application/json";
    const grantsSetCookie = grantsUpstream.headers.get("set-cookie");
    if (grantsUpstream.status !== 200) {
      const response = new Response(grantsText, {
        status: grantsUpstream.status,
        headers: {
          "Content-Type": grantsContentType,
          "Cache-Control": "no-store"
        }
      });
      if (grantsSetCookie) {
        response.headers.set("set-cookie", grantsSetCookie);
      }
      return response;
    }

    const items = parseGrantItems(grantsText).filter((entry) => entry.asset_id === assetId);
    const output: AccessGrantsResponse = {
      items
    };
    const response = NextResponse.json(output, {
      status: 200,
      headers: {
        "Cache-Control": "no-store"
      }
    });
    if (grantsSetCookie) {
      response.headers.set("set-cookie", grantsSetCookie);
    }
    return response;
  } catch (err: unknown) {
    if (err instanceof Error) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    return NextResponse.json({ error: "access grants route failed" }, { status: 500 });
  }
}

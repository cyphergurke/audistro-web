import { randomUUID } from "crypto";
import {
  boostRequestTimeoutMs,
  fetchBoostContextFromCatalog,
  fetchTextWithTimeout,
  parseAmountSats,
  parseAssetId,
  parseIdempotencyKey,
  parseMemo,
  resolveReachableFapUrl
} from "@/lib/boostServer";
import { getServerEnv } from "@/lib/env";

export const dynamic = "force-dynamic";

type BoostRequestBody = {
  assetId?: unknown;
  amountSats?: unknown;
  memo?: unknown;
  idempotencyKey?: unknown;
};

export async function POST(req: Request): Promise<Response> {
  try {
    const body = (await req.json()) as BoostRequestBody;
    const assetId = parseAssetId(String(body.assetId ?? ""));
    const amountSats = parseAmountSats(body.amountSats);
    const memo = parseMemo(body.memo);
    const idempotencyKey = parseIdempotencyKey(body.idempotencyKey) ?? randomUUID();
    const { catalogBaseUrl, fapBaseUrl } = getServerEnv();
    const boostContext = await fetchBoostContextFromCatalog(catalogBaseUrl, assetId);
    const reachableFapUrl = resolveReachableFapUrl(boostContext.fapUrl, fapBaseUrl);

    const boostUrl = new URL("/v1/boost", reachableFapUrl).toString();
    const upstream = await fetchTextWithTimeout(boostUrl, boostRequestTimeoutMs, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        asset_id: assetId,
        payee_id: boostContext.fapPayeeId,
        amount_msat: amountSats * 1000,
        memo,
        idempotency_key: idempotencyKey
      })
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
    return Response.json({ error: "boost route failed" }, { status: 500 });
  }
}

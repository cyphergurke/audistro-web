import { getServerEnv } from "@/lib/env";
import {
  fetchTextWithTimeout,
  parseFromDays,
  ledgerRequestTimeoutMs,
  parseLedgerCursor,
  parseLedgerKind,
  parseLedgerLimit,
  parseLedgerListResponse,
  parseLedgerStatus,
  resolveWindowTimestamps
} from "@/lib/ledger";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const maxQueryLength = 4096;

export async function GET(req: Request): Promise<Response> {
  try {
    const requestURL = new URL(req.url);
    if (requestURL.search.length > maxQueryLength) {
      throw new Error("query string is too long");
    }

    const kind = parseLedgerKind(requestURL.searchParams.get("kind"));
    const status = parseLedgerStatus(requestURL.searchParams.get("status")) ?? "paid";
    const limit = parseLedgerLimit(requestURL.searchParams.get("limit"), 50);
    const cursor = parseLedgerCursor(requestURL.searchParams.get("cursor"));
    const fromDays = parseFromDays(requestURL.searchParams.get("fromDays"));
    const { from, to } = resolveWindowTimestamps(fromDays);

    const inboundCookie = req.headers.get("cookie") ?? "";
    const { fapBaseUrl } = getServerEnv();
    const upstreamURL = new URL("/v1/ledger", fapBaseUrl);
    upstreamURL.searchParams.set("limit", String(limit));
    if (kind) {
      upstreamURL.searchParams.set("kind", kind);
    }
    if (status) {
      upstreamURL.searchParams.set("status", status);
    }
    if (cursor) {
      upstreamURL.searchParams.set("cursor", cursor);
    }

    const upstream = await fetchTextWithTimeout(upstreamURL.toString(), ledgerRequestTimeoutMs, {
      method: "GET",
      headers: {
        cookie: inboundCookie
      }
    });

    if (upstream.status !== 200) {
      const response = new Response(upstream.text, {
        status: upstream.status,
        headers: {
          "Content-Type": upstream.contentType,
          "Cache-Control": "no-store"
        }
      });
      if (upstream.setCookie) {
        response.headers.set("set-cookie", upstream.setCookie);
      }
      return response;
    }

    const parsed = parseLedgerListResponse(upstream.text);

    const response = NextResponse.json(
      {
        from_days: fromDays,
        from,
        to,
        device_id: parsed.device_id,
        items: parsed.items,
        next_cursor: parsed.next_cursor
      },
      {
        status: 200,
        headers: {
          "Cache-Control": "no-store"
        }
      }
    );
    if (upstream.setCookie) {
      response.headers.set("set-cookie", upstream.setCookie);
    }
    return response;
  } catch (err: unknown) {
    if (err instanceof Error) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    return NextResponse.json({ error: "ledger route failed" }, { status: 500 });
  }
}

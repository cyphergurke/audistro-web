import { getServerEnv } from "@/lib/env";
import {
  fetchTextWithTimeout,
  filterEntriesByWindow,
  ledgerRequestTimeoutMs,
  parseLedgerCursor,
  parseLedgerKind,
  parseLedgerLimit,
  parseLedgerListResponse,
  parseLedgerStatus,
  parseUnixSeconds
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
    const status = parseLedgerStatus(requestURL.searchParams.get("status"));
    const limit = parseLedgerLimit(requestURL.searchParams.get("limit"));
    const cursor = parseLedgerCursor(requestURL.searchParams.get("cursor"));
    const from = parseUnixSeconds(requestURL.searchParams.get("from"), "from");
    const to = parseUnixSeconds(requestURL.searchParams.get("to"), "to");
    if (from !== null && to !== null && from > to) {
      throw new Error("from must be <= to");
    }

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
    const filteredItems =
      from !== null || to !== null
        ? filterEntriesByWindow(
            parsed.items,
            from ?? Number.MIN_SAFE_INTEGER,
            to ?? Number.MAX_SAFE_INTEGER
          )
        : parsed.items;

    const response = NextResponse.json(
      {
        device_id: parsed.device_id,
        items: filteredItems,
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

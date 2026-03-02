import { getServerEnv } from "@/lib/env";
import {
  filterEntriesByWindow,
  parseLedgerCursor,
  parseLedgerListResponse,
  parseLedgerKind,
  parseLedgerLimit,
  parseLedgerStatus,
  parseUnixSeconds
} from "@/lib/ledger";
import { APIClientError, createAPIClient } from "@/src/lib/apiClient";
import type { paths as FAPPaths } from "@/src/gen/fap";
import type { LedgerEntry } from "@/lib/types";
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
    const fapClient = createAPIClient<FAPPaths>(fapBaseUrl);
    let parsed: FAPPaths["/v1/ledger"]["get"]["responses"][200]["content"]["application/json"];
    let setCookie: string | null = null;
    try {
      const upstream = await fapClient.requestJSON({
        method: "get",
        path: "/v1/ledger",
        cookie: inboundCookie,
        query: {
          limit,
          kind: kind ?? undefined,
          status: status ?? undefined,
          cursor: cursor ?? undefined
        }
      });
      parsed = upstream.data;
      setCookie = upstream.setCookie;
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
    const normalizedResponse = parseLedgerListResponse(JSON.stringify(parsed));
    const normalizedItems: LedgerEntry[] = normalizedResponse.items.map((item) => ({
      ...item,
      paid_at: item.paid_at ?? null
    }));

    const filteredItems =
      from !== null || to !== null
        ? filterEntriesByWindow(
            normalizedItems,
            from ?? Number.MIN_SAFE_INTEGER,
            to ?? Number.MAX_SAFE_INTEGER
          )
        : normalizedItems;

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
    if (setCookie) {
      response.headers.set("set-cookie", setCookie);
    }
    return response;
  } catch (err: unknown) {
    if (err instanceof Error) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    return NextResponse.json({ error: "ledger route failed" }, { status: 500 });
  }
}

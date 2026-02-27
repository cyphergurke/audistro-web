import { boostRequestTimeoutMs } from "@/lib/boostServer";
import { getServerEnv } from "@/lib/env";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

function parseOptionalJSON(text: string): unknown {
  if (text.trim() === "") {
    return {};
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { error: text };
  }
}

export async function POST(req: Request): Promise<Response> {
  try {
    const { fapBaseUrl } = getServerEnv();
    const upstreamUrl = new URL("/v1/device/bootstrap", fapBaseUrl).toString();
    const inboundCookie = req.headers.get("cookie") ?? "";

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), boostRequestTimeoutMs);
    const upstream = await fetch(upstreamUrl, {
      method: "POST",
      cache: "no-store",
      signal: controller.signal,
      headers: {
        cookie: inboundCookie
      }
    });
    clearTimeout(timeout);

    const text = await upstream.text();
    const contentType = upstream.headers.get("content-type") ?? "application/json";
    const setCookie = upstream.headers.get("set-cookie");

    const response = contentType.includes("application/json")
      ? NextResponse.json(parseOptionalJSON(text), {
          status: upstream.status,
          headers: {
            "Cache-Control": "no-store"
          }
        })
      : new Response(text, {
          status: upstream.status,
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
    return NextResponse.json({ error: "device bootstrap failed" }, { status: 500 });
  }
}

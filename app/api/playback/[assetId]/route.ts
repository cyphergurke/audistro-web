import { getServerEnv } from "@/lib/env";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{
    assetId: string;
  }>;
};

export async function GET(_req: Request, { params }: RouteContext): Promise<Response> {
  const { catalogBaseUrl } = getServerEnv();
  const { assetId: rawAssetId } = await params;
  const assetId = rawAssetId.trim();

  if (!assetId) {
    return Response.json({ error: "assetId is required" }, { status: 400 });
  }

  const url = `${catalogBaseUrl}/v1/playback/${encodeURIComponent(assetId)}`;
  const upstream = await fetch(url, {
    method: "GET",
    cache: "no-store"
  });

  const text = await upstream.text();
  const contentType = upstream.headers.get("content-type") ?? "application/json";

  return new Response(text, {
    status: upstream.status,
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "no-store"
    }
  });
}

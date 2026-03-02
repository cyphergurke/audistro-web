import { fetchCatalogGET } from "@/lib/catalogServer";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{
    assetId: string;
  }>;
};

export async function GET(_req: Request, { params }: RouteContext): Promise<Response> {
  const { assetId: rawAssetId } = await params;
  const assetId = rawAssetId.trim();

  if (!assetId) {
    return Response.json({ error: "assetId is required" }, { status: 400 });
  }

  const upstream = await fetchCatalogGET(`/v1/playback/${encodeURIComponent(assetId)}`);

  return new Response(upstream.text, {
    status: upstream.status,
    headers: {
      "Content-Type": upstream.contentType,
      "Cache-Control": "no-store"
    }
  });
}

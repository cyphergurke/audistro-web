import type { CatalogArtist, CatalogBrowseArtistsResponse } from "@/lib/adminTypes";
import { fetchCatalogGET } from "@/lib/catalogServer";
import { assertDevAdminEnabled } from "@/lib/devAdmin";

export const dynamic = "force-dynamic";

const adminTimeoutMs = 5000;

function sortArtists(artists: CatalogArtist[]): CatalogArtist[] {
  return [...artists].sort((left, right) => {
    const leftLabel = `${left.display_name} ${left.handle}`.trim().toLowerCase();
    const rightLabel = `${right.display_name} ${right.handle}`.trim().toLowerCase();
    return leftLabel.localeCompare(rightLabel);
  });
}

export async function GET(): Promise<Response> {
  try {
    assertDevAdminEnabled();
    const upstream = await fetchCatalogGET("/v1/browse/artists", adminTimeoutMs);

    if (upstream.status !== 200) {
      return Response.json(
        { error: upstream.text || `artists lookup failed (${upstream.status})` },
        { status: 502 }
      );
    }

    const parsed = JSON.parse(upstream.text) as CatalogBrowseArtistsResponse;
    const artists = Array.isArray(parsed.artists) ? sortArtists(parsed.artists) : [];

    return Response.json({ artists }, { status: 200, headers: { "Cache-Control": "no-store" } });
  } catch (err: unknown) {
    if (err instanceof Error && err.message === "dev_admin_disabled") {
      return Response.json({ error: "dev_admin_disabled" }, { status: 403 });
    }
    if (err instanceof Error) {
      return Response.json({ error: err.message }, { status: 400 });
    }
    return Response.json({ error: "admin artists route failed" }, { status: 500 });
  }
}

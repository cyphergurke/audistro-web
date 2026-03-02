import type { CatalogArtistPayeesResponse, CatalogPayee } from "@/lib/adminTypes";
import { fetchCatalogGET } from "@/lib/catalogServer";
import { assertDevAdminEnabled, parseAdminID } from "@/lib/devAdmin";

export const dynamic = "force-dynamic";

const adminTimeoutMs = 5000;

function sortPayees(payees: CatalogPayee[]): CatalogPayee[] {
  return [...payees].sort((left, right) => left.payee_id.localeCompare(right.payee_id));
}

export async function GET(
  _req: Request,
  context: { params: Promise<{ handle: string }> }
): Promise<Response> {
  try {
    assertDevAdminEnabled();
    const { handle } = await context.params;
    const artistHandle = parseAdminID("handle", handle);
    const upstream = await fetchCatalogGET(`/v1/artists/${artistHandle}/payees`, adminTimeoutMs);

    if (upstream.status !== 200) {
      return Response.json(
        { error: upstream.text || `artist payees lookup failed (${upstream.status})` },
        { status: upstream.status === 404 ? 404 : 502 }
      );
    }

    const parsed = JSON.parse(upstream.text) as CatalogArtistPayeesResponse;
    const payees = Array.isArray(parsed.payees) ? sortPayees(parsed.payees) : [];
    return Response.json({ payees }, { status: 200, headers: { "Cache-Control": "no-store" } });
  } catch (err: unknown) {
    if (err instanceof Error && err.message === "dev_admin_disabled") {
      return Response.json({ error: "dev_admin_disabled" }, { status: 403 });
    }
    if (err instanceof Error) {
      return Response.json({ error: err.message }, { status: 400 });
    }
    return Response.json({ error: "admin artist payees route failed" }, { status: 500 });
  }
}

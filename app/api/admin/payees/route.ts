import type {
  CatalogArtist,
  CatalogBrowseArtistsResponse,
  CatalogPayeeResponse,
  FAPPayeeCreateResponse
} from "@/lib/adminTypes";
import { fetchCatalogGET } from "@/lib/catalogServer";
import {
  assertDevAdminEnabled,
  fetchTextWithTimeout,
  parseAdminID,
  parseHTTPURL,
  parseOptionalAdminID,
  validateLNBitsBaseUrl
} from "@/lib/devAdmin";
import { getServerEnv } from "@/lib/env";

export const dynamic = "force-dynamic";

const adminTimeoutMs = 6000;

type AdminPayeeBody = {
  artistId?: unknown;
  payeeId?: unknown;
  fapPayeeId?: unknown;
  fapPublicBaseUrl?: unknown;
  lnbitsBaseUrl?: unknown;
  lnbitsInvoiceKey?: unknown;
  lnbitsReadKey?: unknown;
  displayName?: unknown;
};

function parseRequiredString(name: string, value: unknown, maxLength: number): string {
  if (typeof value !== "string") {
    throw new Error(`${name} is required`);
  }
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`${name} is required`);
  }
  if (trimmed.length > maxLength) {
    throw new Error(`${name} is too long`);
  }
  return trimmed;
}

function parseOptionalString(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  if (trimmed.length > maxLength) {
    throw new Error("value is too long");
  }
  return trimmed;
}

function parseArtists(payloadText: string): CatalogArtist[] {
  const parsed = JSON.parse(payloadText) as CatalogBrowseArtistsResponse;
  return Array.isArray(parsed.artists) ? parsed.artists : [];
}

function parseCatalogPayeeID(payloadText: string): string {
  const parsed = JSON.parse(payloadText) as CatalogPayeeResponse;
  return parsed.payee?.payee_id ?? "";
}

function parseFAPPayeeID(payloadText: string): string {
  const parsed = JSON.parse(payloadText) as FAPPayeeCreateResponse;
  return parsed.payee_id ?? "";
}

export async function POST(req: Request): Promise<Response> {
  try {
    assertDevAdminEnabled();
    const body = (await req.json()) as AdminPayeeBody;
    const { catalogBaseUrl, fapBaseUrl } = getServerEnv();

    const artistId = parseAdminID("artist_id", String(body.artistId ?? ""));
    const manualPayeeID = parseOptionalAdminID(
      "payee_id",
      typeof body.payeeId === "string" ? body.payeeId : null
    );
    const requestedFAPPayeeID = parseOptionalAdminID(
      "fap_payee_id",
      typeof body.fapPayeeId === "string" ? body.fapPayeeId : null
    );
    const displayName = parseOptionalString(body.displayName, 128) ?? `Payee ${artistId}`;
    const lnbitsBaseUrl = validateLNBitsBaseUrl(String(body.lnbitsBaseUrl ?? ""));
    const lnbitsInvoiceKey = parseRequiredString("FAP_LNBITS_INVOICE_API_KEY", body.lnbitsInvoiceKey, 4096);
    const lnbitsReadKey = parseRequiredString("FAP_LNBITS_READONLY_API_KEY", body.lnbitsReadKey, 4096);
    const fallbackFAPPublicBaseURL =
      process.env.NEXT_PUBLIC_FAP_PUBLIC_BASE_URL ?? "http://localhost:18081";
    const fapPublicBaseURL = parseHTTPURL(
      "fap_public_base_url",
      typeof body.fapPublicBaseUrl === "string" && body.fapPublicBaseUrl.trim()
        ? body.fapPublicBaseUrl
        : fallbackFAPPublicBaseURL
    );

    const artistsLookup = await fetchCatalogGET("/v1/browse/artists", adminTimeoutMs);
    if (artistsLookup.status !== 200) {
      return Response.json(
        { error: artistsLookup.text || "failed to load artists from catalog" },
        { status: 502 }
      );
    }
    const artists = parseArtists(artistsLookup.text);
    const artist = artists.find((item) => item.artist_id === artistId);
    if (!artist) {
      return Response.json({ error: "artist_id not found in catalog browse list" }, { status: 404 });
    }

    const fapCreate = await fetchTextWithTimeout(new URL("/v1/payees", fapBaseUrl).toString(), adminTimeoutMs, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        display_name: displayName,
        lnbits_base_url: lnbitsBaseUrl,
        FAP_LNBITS_INVOICE_API_KEY: lnbitsInvoiceKey,
        FAP_LNBITS_READONLY_API_KEY: lnbitsReadKey
      })
    });
    if (fapCreate.status !== 200) {
      return Response.json(
        { error: fapCreate.text || `fap payee create failed (${fapCreate.status})` },
        { status: 502 }
      );
    }
    const createdFAPPayeeID = parseAdminID("fap payee id", parseFAPPayeeID(fapCreate.text));

    const effectiveFAPPayeeID = requestedFAPPayeeID ?? createdFAPPayeeID;
    if (manualPayeeID && manualPayeeID !== createdFAPPayeeID) {
      return Response.json(
        {
          error:
            "manual payee_id is not supported for FAP create flow; use returned payee_id or leave empty"
        },
        { status: 400 }
      );
    }

    const catalogCreate = await fetchTextWithTimeout(
      new URL("/v1/payees", catalogBaseUrl).toString(),
      adminTimeoutMs,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          artist_handle: artist.handle,
          fap_public_base_url: fapPublicBaseURL,
          fap_payee_id: effectiveFAPPayeeID
        })
      }
    );

    let catalogPayeeID = "";
    if (catalogCreate.status === 201) {
      catalogPayeeID = parseCatalogPayeeID(catalogCreate.text);
    } else if (catalogCreate.status !== 409) {
      return Response.json(
        { error: catalogCreate.text || `catalog payee create failed (${catalogCreate.status})` },
        { status: 502 }
      );
    }

    return Response.json(
      {
        artist_id: artist.artist_id,
        artist_handle: artist.handle,
        fap_payee_id: createdFAPPayeeID,
        catalog_fap_payee_id: effectiveFAPPayeeID,
        catalog_payee_id: catalogPayeeID || null,
        fap_public_base_url: fapPublicBaseURL
      },
      { status: 200, headers: { "Cache-Control": "no-store" } }
    );
  } catch (err: unknown) {
    if (err instanceof Error && err.message === "dev_admin_disabled") {
      return Response.json({ error: "dev_admin_disabled" }, { status: 403 });
    }
    if (err instanceof Error) {
      return Response.json({ error: err.message }, { status: 400 });
    }
    return Response.json({ error: "admin payees route failed" }, { status: 500 });
  }
}

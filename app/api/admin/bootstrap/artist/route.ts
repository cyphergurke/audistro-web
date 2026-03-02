import type { AdminBootstrapArtistResponse, FAPPayeeCreateResponse } from "@/lib/adminTypes";
import {
  assertDevAdminEnabled,
  fetchTextWithTimeout,
  parseAdminID,
  parseOptionalAdminID,
  parseHTTPURL,
  validateLNBitsBaseUrl
} from "@/lib/devAdmin";
import { getServerEnv } from "@/lib/env";

export const dynamic = "force-dynamic";

const adminTimeoutMs = 6000;

type AdminBootstrapBody = {
  artistId?: unknown;
  payeeId?: unknown;
  handle?: unknown;
  displayName?: unknown;
  pubkeyHex?: unknown;
  lnbitsBaseUrl?: unknown;
  lnbitsInvoiceKey?: unknown;
  lnbitsReadKey?: unknown;
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

function parseFAPPayeeID(payloadText: string): string {
  const parsed = JSON.parse(payloadText) as FAPPayeeCreateResponse;
  return parseAdminID("fap payee id", parsed.payee_id ?? "");
}

export async function POST(req: Request): Promise<Response> {
  try {
    assertDevAdminEnabled();
    const body = (await req.json()) as AdminBootstrapBody;
    const { catalogAdminToken, catalogInternalBaseUrl, fapInternalBaseUrl } = getServerEnv();

    const artistId = parseOptionalAdminID(
      "artist_id",
      typeof body.artistId === "string" ? body.artistId : null
    );
    const payeeId = parseOptionalAdminID(
      "payee_id",
      typeof body.payeeId === "string" ? body.payeeId : null
    );
    const handle = parseRequiredString("handle", body.handle, 32).toLowerCase();
    const displayName = parseRequiredString("display_name", body.displayName, 80);
    const pubkeyHex = parseOptionalString(body.pubkeyHex, 66);
    const lnbitsBaseUrl = validateLNBitsBaseUrl(String(body.lnbitsBaseUrl ?? ""));
    const lnbitsInvoiceKey = parseRequiredString("lnbits_invoice_key", body.lnbitsInvoiceKey, 4096);
    const lnbitsReadKey = parseRequiredString("lnbits_read_key", body.lnbitsReadKey, 4096);
    const fapPublicBaseUrl = parseHTTPURL(
      "fap_public_base_url",
      process.env.NEXT_PUBLIC_FAP_PUBLIC_BASE_URL?.trim() || "http://localhost:18081"
    );

    const fapCreate = await fetchTextWithTimeout(
      new URL("/v1/payees", fapInternalBaseUrl).toString(),
      adminTimeoutMs,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          display_name: displayName,
          lnbits_base_url: lnbitsBaseUrl,
          lnbits_invoice_key: lnbitsInvoiceKey,
          lnbits_read_key: lnbitsReadKey
        })
      }
    );
    if (fapCreate.status !== 200) {
      return Response.json(
        { error: fapCreate.text || `fap payee create failed (${fapCreate.status})` },
        { status: 502 }
      );
    }
    const createdFAPPayeeID = parseFAPPayeeID(fapCreate.text);

    const catalogCreate = await fetchTextWithTimeout(
      new URL("/v1/admin/bootstrap/artist", catalogInternalBaseUrl).toString(),
      adminTimeoutMs,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Admin-Token": catalogAdminToken
        },
        body: JSON.stringify({
          artist_id: artistId,
          handle,
          display_name: displayName,
          pubkey_hex: pubkeyHex,
          payee: {
            payee_id: payeeId,
            fap_public_base_url: fapPublicBaseUrl,
            fap_payee_id: createdFAPPayeeID
          }
        })
      }
    );
    if (catalogCreate.status !== 200) {
      return Response.json(
        { error: catalogCreate.text || `catalog bootstrap failed (${catalogCreate.status})` },
        { status: catalogCreate.status === 409 ? 409 : 502 }
      );
    }

    const parsed = JSON.parse(catalogCreate.text) as AdminBootstrapArtistResponse;
    return Response.json(
      {
        artist_id: parsed.artist_id,
        payee_id: parsed.payee_id,
        handle: parsed.handle,
        fap_payee_id: parsed.fap_payee_id
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
    return Response.json({ error: "admin bootstrap route failed" }, { status: 500 });
  }
}

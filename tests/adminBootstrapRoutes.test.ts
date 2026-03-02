import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("admin bootstrap api route", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    process.env = {
      ...originalEnv,
      NODE_ENV: "development",
      NEXT_PUBLIC_DEV_ADMIN: "true",
      CATALOG_ADMIN_TOKEN: "dev-admin-token",
      CATALOG_INTERNAL_BASE_URL: "http://catalog:8080",
      FAP_INTERNAL_BASE_URL: "http://fap:8080",
      NEXT_PUBLIC_FAP_PUBLIC_BASE_URL: "http://localhost:18081"
    };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("enforces dev admin gate", async () => {
    process.env = { ...process.env, NEXT_PUBLIC_DEV_ADMIN: "false" };
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);

    const { POST } = await import("../app/api/admin/bootstrap/artist/route");
    const response = await POST(
      new Request("http://localhost/api/admin/bootstrap/artist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          handle: "artist_bootstrap",
          displayName: "Artist Bootstrap",
          lnbitsBaseUrl: "http://lnbits:5000",
          lnbitsInvoiceKey: "inv",
          lnbitsReadKey: "read"
        })
      })
    );

    expect(response.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects lnbits urls outside the allowlist", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);

    const { POST } = await import("../app/api/admin/bootstrap/artist/route");
    const response = await POST(
      new Request("http://localhost/api/admin/bootstrap/artist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          handle: "artist_bootstrap",
          displayName: "Artist Bootstrap",
          lnbitsBaseUrl: "http://evil.example:5000",
          lnbitsInvoiceKey: "inv",
          lnbitsReadKey: "read"
        })
      })
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "lnbits_base_url host is not allowed" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("creates fap payee then catalog mapping without returning secrets", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            payee_id: "fap_payee_1",
            display_name: "Artist Bootstrap",
            rail: "lightning",
            mode: "lnbits",
            lnbits_base_url: "http://lnbits:5000"
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            artist_id: "ar_bootstrap",
            payee_id: "pe_bootstrap",
            handle: "artist_bootstrap",
            fap_payee_id: "fap_payee_1"
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
      );
    vi.stubGlobal("fetch", fetchMock);

    const { POST } = await import("../app/api/admin/bootstrap/artist/route");
    const response = await POST(
      new Request("http://localhost/api/admin/bootstrap/artist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          handle: "artist_bootstrap",
          displayName: "Artist Bootstrap",
          lnbitsBaseUrl: "http://lnbits:5000",
          lnbitsInvoiceKey: "inv-secret",
          lnbitsReadKey: "read-secret"
        })
      })
    );

    expect(response.status).toBe(200);
    const parsed = await response.json();
    expect(parsed).toEqual({
      artist_id: "ar_bootstrap",
      payee_id: "pe_bootstrap",
      handle: "artist_bootstrap",
      fap_payee_id: "fap_payee_1"
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const [fapURL, fapInit] = fetchMock.mock.calls[0] ?? [];
    expect(String(fapURL)).toBe("http://fap:8080/v1/payees");
    expect(String(fapInit?.body)).toContain("inv-secret");

    const [catalogURL, catalogInit] = fetchMock.mock.calls[1] ?? [];
    expect(String(catalogURL)).toBe("http://catalog:8080/v1/admin/bootstrap/artist");
    expect((catalogInit?.headers as Record<string, string>)["X-Admin-Token"]).toBe(
      "dev-admin-token"
    );
    expect(JSON.stringify(parsed)).not.toContain("inv-secret");
    expect(JSON.stringify(parsed)).not.toContain("read-secret");
  });
});

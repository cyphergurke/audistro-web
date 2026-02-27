import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("spend api routes", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    process.env = {
      ...originalEnv,
      CATALOG_BASE_URL: "http://catalog:8080",
      FAP_BASE_URL: "http://fap:8080"
    };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("/api/me/ledger forwards cookies and clamps limit", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          device_id: "device_1",
          items: [
            {
              entry_id: "entry_1",
              kind: "access",
              status: "paid",
              asset_id: "asset_1",
              payee_id: "payee_1",
              amount_msat: 1000,
              currency: "msat",
              created_at: 1700000000,
              updated_at: 1700000000,
              paid_at: 1700000001
            }
          ]
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json"
          }
        }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    const { GET } = await import("../app/api/me/ledger/route");
    const response = await GET(
      new Request("http://localhost/api/me/ledger?kind=access&status=paid&limit=999", {
        headers: {
          cookie: "fap_device_id=device_1"
        }
      })
    );

    expect(response.status).toBe(200);
    const payload = (await response.json()) as Record<string, unknown>;
    expect(payload.device_id).toBe("device_1");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [calledURL, calledInit] = fetchMock.mock.calls[0] ?? [];
    expect(String(calledURL)).toContain("/v1/ledger");
    expect(String(calledURL)).toContain("kind=access");
    expect(String(calledURL)).toContain("status=paid");
    expect(String(calledURL)).toContain("limit=100");
    const headers = (calledInit as RequestInit | undefined)?.headers as Record<string, string>;
    expect(headers.cookie).toBe("fap_device_id=device_1");
  });

  it("/api/me/spend-summary aggregates ledger and catalog labels", async () => {
    const firstLedgerPage = {
      device_id: "device_1",
      items: [
        {
          entry_id: "entry_1",
          kind: "access",
          status: "paid",
          asset_id: "asset_1",
          payee_id: "payee_a",
          amount_msat: 2000,
          currency: "msat",
          created_at: 1700000800,
          updated_at: 1700000800,
          paid_at: 1700000801
        },
        {
          entry_id: "entry_2",
          kind: "boost",
          status: "paid",
          asset_id: "asset_2",
          payee_id: "payee_b",
          amount_msat: 5000,
          currency: "msat",
          created_at: 1700000700,
          updated_at: 1700000700,
          paid_at: 1700000701
        }
      ],
      next_cursor: "cursor_1"
    };
    const secondLedgerPage = {
      device_id: "device_1",
      items: [
        {
          entry_id: "entry_3",
          kind: "access",
          status: "paid",
          asset_id: "asset_1",
          payee_id: "payee_a",
          amount_msat: 9000,
          currency: "msat",
          created_at: 1600000000,
          updated_at: 1600000000,
          paid_at: 1600000001
        }
      ]
    };

    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.startsWith("http://fap:8080/v1/ledger")) {
        if (url.includes("cursor=cursor_1")) {
          return new Response(JSON.stringify(secondLedgerPage), {
            status: 200,
            headers: {
              "content-type": "application/json"
            }
          });
        }
        return new Response(JSON.stringify(firstLedgerPage), {
          status: 200,
          headers: {
            "content-type": "application/json"
          }
        });
      }
      if (url === "http://catalog:8080/v1/assets/asset_2") {
        return new Response(
          JSON.stringify({
            asset: {
              asset_id: "asset_2",
              title: "Asset Two"
            },
            artist: {
              handle: "artist_two",
              display_name: "Artist Two"
            }
          }),
          {
            status: 200,
            headers: {
              "content-type": "application/json"
            }
          }
        );
      }
      if (url === "http://catalog:8080/v1/assets/asset_1") {
        return new Response(
          JSON.stringify({
            asset: {
              asset_id: "asset_1",
              title: "Asset One"
            },
            artist: {
              handle: "artist_one",
              display_name: "Artist One"
            }
          }),
          {
            status: 200,
            headers: {
              "content-type": "application/json"
            }
          }
        );
      }
      throw new Error(`unexpected URL: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const { GET } = await import("../app/api/me/spend-summary/route");
    const response = await GET(
      new Request("http://localhost/api/me/spend-summary?from=1700000000&to=1700000900", {
        headers: {
          cookie: "fap_device_id=device_1"
        }
      })
    );

    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      totals: {
        total_paid_msat_access: number;
        total_paid_msat_boost: number;
        total_paid_msat_all: number;
      };
      top_assets: Array<{ asset_id: string; title?: string }>;
      top_payees: Array<{ payee_id: string; artist_handle?: string }>;
      items_count: number;
    };

    expect(payload.totals.total_paid_msat_access).toBe(2000);
    expect(payload.totals.total_paid_msat_boost).toBe(5000);
    expect(payload.totals.total_paid_msat_all).toBe(7000);
    expect(payload.top_assets[0]?.asset_id).toBe("asset_2");
    expect(payload.top_assets[0]?.title).toBe("Asset Two");
    expect(payload.top_payees[0]?.payee_id).toBe("payee_b");
    expect(payload.top_payees[0]?.artist_handle).toBe("artist_two");
    expect(payload.items_count).toBe(2);

    const firstCallHeaders = (fetchMock.mock.calls[0]?.[1] as RequestInit | undefined)
      ?.headers as Record<string, string>;
    expect(firstCallHeaders.cookie).toBe("fap_device_id=device_1");
  });
});

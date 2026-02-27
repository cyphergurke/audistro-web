import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("spend api routes", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-27T12:00:00.000Z"));
    process.env = {
      ...originalEnv,
      CATALOG_BASE_URL: "http://catalog:8080",
      FAP_BASE_URL: "http://fap:8080"
    };
  });

  afterEach(() => {
    vi.useRealTimers();
    process.env = originalEnv;
  });

  it("/api/me/ledger forwards cookies, defaults to paid and includes computed window", async () => {
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
              created_at: 1772193000,
              updated_at: 1772193000,
              paid_at: 1772193001
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
      new Request("http://localhost/api/me/ledger?kind=access&limit=999&fromDays=7", {
        headers: {
          cookie: "fap_device_id=device_1"
        }
      })
    );

    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      from_days: number;
      from: number;
      to: number;
      device_id?: string;
      items: unknown[];
    };
    expect(payload.from_days).toBe(7);
    expect(payload.from).toBeLessThan(payload.to);
    expect(payload.device_id).toBe("device_1");
    expect(payload.items).toHaveLength(1);

    const [calledURL, calledInit] = fetchMock.mock.calls[0] ?? [];
    expect(String(calledURL)).toContain("/v1/ledger");
    expect(String(calledURL)).toContain("kind=access");
    expect(String(calledURL)).toContain("status=paid");
    expect(String(calledURL)).toContain("limit=100");
    const headers = (calledInit as RequestInit | undefined)?.headers as Record<string, string>;
    expect(headers.cookie).toBe("fap_device_id=device_1");
  });

  it("/api/me/spend-summary aggregates with playback labels and returns expected response shape", async () => {
    const nowUnix = Math.floor(new Date("2026-02-27T12:00:00.000Z").getTime() / 1000);
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
          created_at: nowUnix - 1000,
          updated_at: nowUnix - 1000,
          paid_at: nowUnix - 999
        },
        {
          entry_id: "entry_2",
          kind: "boost",
          status: "paid",
          asset_id: "asset_2",
          payee_id: "payee_b",
          amount_msat: 5000,
          currency: "msat",
          created_at: nowUnix - 2000,
          updated_at: nowUnix - 2000,
          paid_at: nowUnix - 1999
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
          created_at: nowUnix - 90 * 24 * 60 * 60,
          updated_at: nowUnix - 90 * 24 * 60 * 60,
          paid_at: nowUnix - 90 * 24 * 60 * 60
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
      if (url === "http://catalog:8080/v1/playback/asset_2") {
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
      if (url === "http://catalog:8080/v1/playback/asset_1") {
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
      new Request("http://localhost/api/me/spend-summary?fromDays=30", {
        headers: {
          cookie: "fap_device_id=device_1"
        }
      })
    );

    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      window_days: number;
      totals: {
        paid_msat_access: number;
        paid_msat_boost: number;
        paid_msat_total: number;
      };
      top_assets: Array<{ asset_id: string; title?: string; artist?: string }>;
      top_payees: Array<{ payee_id: string; amount_msat: number }>;
      items_count: number;
      truncated: boolean;
    };

    expect(payload.window_days).toBe(30);
    expect(payload.totals.paid_msat_access).toBe(2000);
    expect(payload.totals.paid_msat_boost).toBe(5000);
    expect(payload.totals.paid_msat_total).toBe(7000);
    expect(payload.top_assets[0]?.asset_id).toBe("asset_2");
    expect(payload.top_assets[0]?.title).toBe("Asset Two");
    expect(payload.top_assets[0]?.artist).toBe("Artist Two");
    expect(payload.top_payees[0]?.payee_id).toBe("payee_b");
    expect(payload.top_payees[0]?.amount_msat).toBe(5000);
    expect(payload.items_count).toBe(2);
    expect(payload.truncated).toBe(false);

    const firstCallHeaders = (fetchMock.mock.calls[0]?.[1] as RequestInit | undefined)
      ?.headers as Record<string, string>;
    expect(firstCallHeaders.cookie).toBe("fap_device_id=device_1");
  });
});

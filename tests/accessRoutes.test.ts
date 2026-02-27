import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function playbackPayload(assetId: string): string {
  return JSON.stringify({
    now: 1772120000,
    asset: {
      asset_id: assetId,
      pay: {
        fap_url: "http://localhost:18081",
        fap_payee_id: "fap_payee_1",
        payee_id: "payee_1",
        price_msat: 1234
      }
    },
    providers: []
  });
}

function playbackPayloadWithPrice(assetId: string, priceMsat: number): string {
  return JSON.stringify({
    now: 1772120000,
    asset: {
      asset_id: assetId,
      pay: {
        fap_url: "http://localhost:18081",
        fap_payee_id: "fap_payee_1",
        payee_id: "payee_1",
        price_msat: priceMsat
      }
    },
    providers: []
  });
}

describe("access api routes", () => {
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

  it("returns dev mode token when /v1/access succeeds", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(playbackPayload("asset2"), {
          status: 200,
          headers: {
            "content-type": "application/json"
          }
        })
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            asset_id: "asset2",
            access_token: "token-dev",
            expires_at: 1772120900
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

    const { POST } = await import("../app/api/access/[assetId]/route");
    const response = await POST(new Request("http://localhost/api/access/asset2", { method: "POST" }), {
      params: Promise.resolve({ assetId: "asset2" })
    });

    expect(response.status).toBe(200);
    const parsed = (await response.json()) as Record<string, unknown>;
    expect(parsed.mode).toBe("dev");
    expect(parsed.access_token).toBe("token-dev");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("forwards set-cookie from /api/device/bootstrap", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(
      new Response(JSON.stringify({ device_id: "dev_1" }), {
        status: 200,
        headers: {
          "content-type": "application/json",
          "set-cookie": "fap_device_id=dev_1; Path=/; HttpOnly"
        }
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const { POST } = await import("../app/api/device/bootstrap/route");
    const response = await POST(new Request("http://localhost/api/device/bootstrap", { method: "POST" }));

    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toContain("fap_device_id=dev_1");
    expect(await response.json()).toEqual({ device_id: "dev_1" });
  });

  it("falls back to challenge flow when dev access is disabled", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(playbackPayload("asset2"), {
          status: 200,
          headers: {
            "content-type": "application/json"
          }
        })
      )
      .mockResolvedValueOnce(
        new Response(`{"error":"dev_mode_disabled"}`, {
          status: 403,
          headers: {
            "content-type": "application/json"
          }
        })
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            challenge_id: "intent_123",
            bolt11: "lnbc123",
            expires_at: 1772120900,
            amount_msat: 1000
          }),
          {
            status: 200,
            headers: {
              "content-type": "application/json",
              "set-cookie": "fap_device_id=dev_cookie; Path=/; HttpOnly"
            }
          }
        )
      );
    vi.stubGlobal("fetch", fetchMock);

    const { POST } = await import("../app/api/access/[assetId]/route");
    const response = await POST(
      new Request("http://localhost/api/access/asset2", {
        method: "POST",
        headers: {
          cookie: "fap_device_id=inbound_cookie"
        }
      }),
      {
        params: Promise.resolve({ assetId: "asset2" })
      }
    );

    expect(response.status).toBe(200);
    const parsed = (await response.json()) as Record<string, unknown>;
    expect(parsed.mode).toBe("invoice");
    expect(parsed.challenge_id).toBe("intent_123");
    expect(response.headers.get("set-cookie")).toContain("fap_device_id=dev_cookie");
    const devAccessCallInit = fetchMock.mock.calls[1]?.[1] as RequestInit | undefined;
    const challengeCallInit = fetchMock.mock.calls[2]?.[1] as RequestInit | undefined;
    expect((devAccessCallInit?.headers as Record<string, string>).cookie).toBe(
      "fap_device_id=inbound_cookie"
    );
    expect((challengeCallInit?.headers as Record<string, string>).cookie).toBe(
      "fap_device_id=inbound_cookie"
    );
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("falls back to challenge flow when dev access returns asset not found", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(playbackPayload("asset2"), {
          status: 200,
          headers: {
            "content-type": "application/json"
          }
        })
      )
      .mockResolvedValueOnce(
        new Response(`{"error":"not found: asset"}`, {
          status: 404,
          headers: {
            "content-type": "application/json"
          }
        })
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            challenge_id: "challenge_404_fallback",
            bolt11: "lnbc404",
            expires_at: 1772120900,
            amount_msat: 1000
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

    const { POST } = await import("../app/api/access/[assetId]/route");
    const response = await POST(new Request("http://localhost/api/access/asset2", { method: "POST" }), {
      params: Promise.resolve({ assetId: "asset2" })
    });

    expect(response.status).toBe(200);
    const parsed = (await response.json()) as Record<string, unknown>;
    expect(parsed.mode).toBe("invoice");
    expect(parsed.challenge_id).toBe("challenge_404_fallback");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("clamps challenge amount_msat to max when catalog price is too high", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(playbackPayloadWithPrice("asset2", 99_999_999), {
          status: 200,
          headers: {
            "content-type": "application/json"
          }
        })
      )
      .mockResolvedValueOnce(
        new Response(`{"error":"dev_mode_disabled"}`, {
          status: 403,
          headers: {
            "content-type": "application/json"
          }
        })
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            challenge_id: "challenge_max",
            bolt11: "lnbcmax",
            expires_at: 1772120900,
            amount_msat: 50_000_000
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

    const { POST } = await import("../app/api/access/[assetId]/route");
    const response = await POST(new Request("http://localhost/api/access/asset2", { method: "POST" }), {
      params: Promise.resolve({ assetId: "asset2" })
    });

    expect(response.status).toBe(200);
    const challengeCallInit = fetchMock.mock.calls[2]?.[1] as RequestInit | undefined;
    const challengePayload = JSON.parse(String(challengeCallInit?.body)) as Record<string, unknown>;
    expect(challengePayload.amount_msat).toBe(50_000_000);
  });

  it("retries challenge with payee_id when fap_payee_id is not found", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(playbackPayload("asset2"), {
          status: 200,
          headers: {
            "content-type": "application/json"
          }
        })
      )
      .mockResolvedValueOnce(
        new Response(`{"error":"dev_mode_disabled"}`, {
          status: 403,
          headers: {
            "content-type": "application/json"
          }
        })
      )
      .mockResolvedValueOnce(
        new Response(`{"error":"not found: payee"}`, {
          status: 404,
          headers: {
            "content-type": "application/json"
          }
        })
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            challenge_id: "challenge_payee_retry",
            bolt11: "lnbcpayee",
            expires_at: 1772120900,
            amount_msat: 1234
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

    const { POST } = await import("../app/api/access/[assetId]/route");
    const response = await POST(new Request("http://localhost/api/access/asset2", { method: "POST" }), {
      params: Promise.resolve({ assetId: "asset2" })
    });

    expect(response.status).toBe(200);
    const parsed = (await response.json()) as Record<string, unknown>;
    expect(parsed.mode).toBe("invoice");
    expect(parsed.challenge_id).toBe("challenge_payee_retry");

    const firstChallengeInit = fetchMock.mock.calls[2]?.[1] as RequestInit | undefined;
    const secondChallengeInit = fetchMock.mock.calls[3]?.[1] as RequestInit | undefined;
    const firstChallengeBody = JSON.parse(String(firstChallengeInit?.body)) as Record<string, unknown>;
    const secondChallengeBody = JSON.parse(String(secondChallengeInit?.body)) as Record<string, unknown>;
    expect(firstChallengeBody.payee_id).toBe("fap_payee_1");
    expect(secondChallengeBody.payee_id).toBe("payee_1");
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("classifies token exchange pending and paid states", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(playbackPayload("asset2"), {
          status: 200,
          headers: {
            "content-type": "application/json"
          }
        })
      )
      .mockResolvedValueOnce(
        new Response(`{"error":"payment not settled"}`, {
          status: 409,
          headers: {
            "content-type": "application/json"
          }
        })
      )
      .mockResolvedValueOnce(
        new Response(playbackPayload("asset2"), {
          status: 200,
          headers: {
            "content-type": "application/json"
          }
        })
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            token: "token-paid",
            expires_at: 1772120950,
            resource_id: "hls:key:asset2"
          }),
          {
            status: 200,
            headers: {
              "content-type": "application/json",
              "set-cookie": "fap_device_id=dev_cookie; Path=/; HttpOnly"
            }
          }
        )
      );
    vi.stubGlobal("fetch", fetchMock);

    const { POST } = await import("../app/api/access/token/route");

    const pendingResponse = await POST(
      new Request("http://localhost/api/access/token", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          assetId: "asset2",
          challengeId: "intent_123"
        })
      })
    );
    expect(pendingResponse.status).toBe(200);
    expect(await pendingResponse.json()).toEqual({ status: "pending" });

    const paidResponse = await POST(
      new Request("http://localhost/api/access/token", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          assetId: "asset2",
          challengeId: "intent_123"
        })
      })
    );
    expect(paidResponse.status).toBe(200);
    expect(await paidResponse.json()).toEqual({
      status: "paid",
      access_token: "token-paid",
      expires_at: 1772120950,
      resource_id: "hls:key:asset2"
    });
    expect(paidResponse.headers.get("set-cookie")).toContain("fap_device_id=dev_cookie");
  });

  it("proxies /api/hls-key and returns 16 bytes", async () => {
    const keyBytes = new Uint8Array(16).fill(7);
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(playbackPayload("asset2"), {
          status: 200,
          headers: {
            "content-type": "application/json"
          }
        })
      )
      .mockResolvedValueOnce(
        new Response(keyBytes, {
          status: 200,
          headers: {
            "content-type": "application/octet-stream",
            "set-cookie": "fap_device_id=dev_cookie; Path=/; HttpOnly"
          }
        })
      );
    vi.stubGlobal("fetch", fetchMock);

    const { GET } = await import("../app/api/hls-key/[assetId]/route");
    const response = await GET(
      new Request("http://localhost/api/hls-key/asset2?token=abcdefghijklmnopqrstuvwxyz", {
        method: "GET",
        headers: {
          cookie: "fap_device_id=inbound_cookie"
        }
      }),
      {
        params: Promise.resolve({ assetId: "asset2" })
      }
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toContain("fap_device_id=dev_cookie");
    expect((await response.arrayBuffer()).byteLength).toBe(16);

    const keyCallInit = fetchMock.mock.calls[1]?.[1] as RequestInit | undefined;
    const keyHeaders = keyCallInit?.headers as Record<string, string>;
    expect(keyHeaders.cookie).toBe("fap_device_id=inbound_cookie");
    expect(keyHeaders.Authorization).toContain("Bearer ");
  });

  it("returns upstream errors from /api/hls-key", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(playbackPayload("asset2"), {
          status: 200,
          headers: {
            "content-type": "application/json"
          }
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: "payment_required" }), {
          status: 403,
          headers: {
            "content-type": "application/json"
          }
        })
      );
    vi.stubGlobal("fetch", fetchMock);

    const { GET } = await import("../app/api/hls-key/[assetId]/route");
    const response = await GET(
      new Request("http://localhost/api/hls-key/asset2?token=abcdefghijklmnopqrstuvwxyz", {
        method: "GET"
      }),
      {
        params: Promise.resolve({ assetId: "asset2" })
      }
    );

    expect(response.status).toBe(403);
    expect(await response.text()).toContain("payment_required");
  });

  it("returns filtered access grants for the requested asset", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(playbackPayload("asset2"), {
          status: 200,
          headers: {
            "content-type": "application/json"
          }
        })
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            device_id: "dev_1",
            items: [
              {
                asset_id: "asset2",
                status: "active",
                valid_from: 1772120000,
                valid_until: 1772120600,
                minutes_purchased: 10
              },
              {
                asset_id: "asset-other",
                status: "active",
                valid_from: 1772120001,
                valid_until: 1772120601,
                minutes_purchased: 10
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

    const { GET } = await import("../app/api/access/grants/route");
    const response = await GET(
      new Request("http://localhost/api/access/grants?assetId=asset2", {
        method: "GET"
      })
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      items: [
        {
          asset_id: "asset2",
          status: "active",
          valid_from: 1772120000,
          valid_until: 1772120600,
          minutes_purchased: 10
        }
      ]
    });
  });
});

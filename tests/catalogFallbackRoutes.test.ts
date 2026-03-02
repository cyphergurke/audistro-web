import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("catalog GET fallback routes", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    process.env = {
      ...originalEnv,
      CATALOG_BASE_URLS: "http://catalog-primary:8080,http://catalog-mirror:8080",
      CATALOG_BASE_URL: "http://catalog-primary:8080",
      FAP_BASE_URL: "http://fap:8080"
    };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("/api/playback falls back to mirror when primary returns 503", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: "unavailable" }), {
          status: 503,
          headers: { "content-type": "application/json" }
        })
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            now: 1772120000,
            asset: {
              asset_id: "asset_mirror"
            },
            providers: []
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" }
          }
        )
      );
    vi.stubGlobal("fetch", fetchMock);

    const { GET } = await import("../app/api/playback/[assetId]/route");
    const response = await GET(new Request("http://localhost/api/playback/asset_mirror"), {
      params: Promise.resolve({ assetId: "asset_mirror" })
    });

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("http://catalog-primary:8080");
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain("http://catalog-mirror:8080");
    expect(await response.json()).toEqual({
      now: 1772120000,
      asset: { asset_id: "asset_mirror" },
      providers: []
    });
  });
});

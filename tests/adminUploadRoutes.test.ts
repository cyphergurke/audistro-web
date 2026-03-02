import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("admin upload api routes", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    process.env = {
      ...originalEnv,
      NODE_ENV: "development",
      NEXT_PUBLIC_DEV_ADMIN: "true",
      CATALOG_BASE_URL: "http://catalog:8080",
      CATALOG_ADMIN_TOKEN: "dev-admin-token"
    };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("proxies multipart uploads to catalog with admin token", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(
      new Response(JSON.stringify({ asset_id: "asset1", job_id: "job1", status: "queued" }), {
        status: 202,
        headers: { "content-type": "application/json" }
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const { POST } = await import("../app/api/admin/assets/upload/route");
    const form = new FormData();
    form.set("artist_id", "artist1");
    form.set("payee_id", "payee1");
    form.set("title", "Track");
    form.set("price_msat", "1000");
    form.set("audio", new File(["mp3"], "track.mp3", { type: "audio/mpeg" }));

    const response = await POST(
      new Request("http://localhost/api/admin/assets/upload", { method: "POST", body: form })
    );

    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ asset_id: "asset1", job_id: "job1", status: "queued" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] ?? [];
    expect((init?.headers as Record<string, string>)["X-Admin-Token"]).toBe("dev-admin-token");
    expect(init?.body).toBeInstanceOf(FormData);
  });

  it("proxies ingest job lookup with admin token", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(
      new Response(JSON.stringify({ job_id: "job1", asset_id: "asset1", status: "published" }), {
        status: 200,
        headers: { "content-type": "application/json" }
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const { GET } = await import("../app/api/admin/ingest/jobs/[jobId]/route");
    const response = await GET(
      new Request("http://localhost/api/admin/ingest/jobs/job1", { method: "GET" }),
      {
        params: Promise.resolve({ jobId: "job1" })
      }
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      job_id: "job1",
      asset_id: "asset1",
      status: "published"
    });
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toBe("http://catalog:8080/v1/admin/ingest/jobs/job1");
    expect((init?.headers as Record<string, string>)["X-Admin-Token"]).toBe("dev-admin-token");
  });

  it("proxies artist payees lookup", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          payees: [{ payee_id: "pe_artist1", artist_id: "artist1", fap_public_base_url: "http://localhost:18081", fap_payee_id: "fap1" }]
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" }
        }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    const { GET } = await import("../app/api/admin/artists/[handle]/payees/route");
    const response = await GET(new Request("http://localhost/api/admin/artists/artist1/payees"), {
      params: Promise.resolve({ handle: "artist1" })
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      payees: [{ payee_id: "pe_artist1", artist_id: "artist1", fap_public_base_url: "http://localhost:18081", fap_payee_id: "fap1" }]
    });
    const [url] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toBe("http://catalog:8080/v1/artists/artist1/payees");
  });
});

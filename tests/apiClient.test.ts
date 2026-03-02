import { APIClientError, createAPIClient } from "@/src/lib/apiClient";
import type { paths as FAPPaths } from "@/src/gen/fap";
import { afterEach, describe, expect, it, vi } from "vitest";

describe("apiClient", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("maps non-2xx responses into APIClientError", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "payment_required", message: "payment required" }), {
        status: 403,
        headers: {
          "content-type": "application/json",
          "set-cookie": "fap_device_id=device_1; Path=/"
        }
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = createAPIClient<FAPPaths>("http://fap:8080");

    await expect(
      client.requestJSON({
        method: "get",
        path: "/v1/ledger",
        cookie: "fap_device_id=device_1"
      })
    ).rejects.toMatchObject({
      name: "APIClientError",
      status: 403,
      bodyText: '{"error":"payment_required","message":"payment required"}',
      setCookie: "fap_device_id=device_1; Path=/"
    });
  });
});

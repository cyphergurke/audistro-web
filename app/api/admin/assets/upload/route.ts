import { assertDevAdminEnabled } from "@/lib/devAdmin";
import { getServerEnv } from "@/lib/env";
import { APIClientError, createAPIClient } from "@/src/lib/apiClient";
import type { paths as CatalogPaths } from "@/src/gen/catalog";

export const dynamic = "force-dynamic";

const adminTimeoutMs = 15_000;

export async function POST(req: Request): Promise<Response> {
  try {
    assertDevAdminEnabled();
    const { catalogBaseUrl, catalogAdminToken } = getServerEnv();
    const formData = await req.formData();
    const catalogClient = createAPIClient<CatalogPaths>(catalogBaseUrl);
    try {
      const upstream = await catalogClient.requestForm({
        method: "post",
        path: "/v1/admin/assets/upload",
        timeoutMs: adminTimeoutMs,
        headers: {
          "X-Admin-Token": catalogAdminToken
        },
        formData
      });
      return Response.json(upstream.data, {
        status: 202,
        headers: {
          "Cache-Control": "no-store"
        }
      });
    } catch (error: unknown) {
      if (error instanceof APIClientError) {
        return new Response(error.bodyText, {
          status: error.status,
          headers: {
            "Content-Type": error.contentType || "application/json",
            "Cache-Control": "no-store"
          }
        });
      }
      throw error;
    }
  } catch (err: unknown) {
    if (err instanceof Error && err.message === "dev_admin_disabled") {
      return Response.json({ error: "dev_admin_disabled" }, { status: 403 });
    }
    if (err instanceof Error) {
      return Response.json({ error: err.message }, { status: 400 });
    }
    return Response.json({ error: "admin upload proxy failed" }, { status: 500 });
  }
}

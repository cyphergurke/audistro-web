import { assertDevAdminEnabled } from "@/lib/devAdmin";
import { getServerEnv } from "@/lib/env";

export const dynamic = "force-dynamic";

const adminTimeoutMs = 15_000;

export async function POST(req: Request): Promise<Response> {
  try {
    assertDevAdminEnabled();
    const { catalogBaseUrl, catalogAdminToken } = getServerEnv();
    const formData = await req.formData();

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), adminTimeoutMs);
    try {
      const upstream = await fetch(new URL("/v1/admin/assets/upload", catalogBaseUrl), {
        method: "POST",
        headers: {
          "X-Admin-Token": catalogAdminToken
        },
        body: formData,
        cache: "no-store",
        signal: controller.signal
      });
      const payload = await upstream.text();
      return new Response(payload, {
        status: upstream.status,
        headers: {
          "Content-Type": upstream.headers.get("content-type") ?? "application/json",
          "Cache-Control": "no-store"
        }
      });
    } finally {
      clearTimeout(timer);
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

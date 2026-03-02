import { assertDevAdminEnabled, parseAdminID } from "@/lib/devAdmin";
import { fetchTextWithTimeout } from "@/lib/devAdmin";
import { getServerEnv } from "@/lib/env";

export const dynamic = "force-dynamic";

const adminTimeoutMs = 5000;

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ jobId: string }> }
): Promise<Response> {
  try {
    assertDevAdminEnabled();
    const { jobId } = await params;
    const safeJobID = parseAdminID("job_id", jobId);
    const { catalogBaseUrl, catalogAdminToken } = getServerEnv();
    const upstream = await fetchTextWithTimeout(
      new URL(`/v1/admin/ingest/jobs/${safeJobID}`, catalogBaseUrl).toString(),
      adminTimeoutMs,
      {
        method: "GET",
        headers: {
          "X-Admin-Token": catalogAdminToken
        }
      }
    );

    return new Response(upstream.text, {
      status: upstream.status,
      headers: {
        "Content-Type": upstream.contentType || "application/json",
        "Cache-Control": "no-store"
      }
    });
  } catch (err: unknown) {
    if (err instanceof Error && err.message === "dev_admin_disabled") {
      return Response.json({ error: "dev_admin_disabled" }, { status: 403 });
    }
    if (err instanceof Error) {
      return Response.json({ error: err.message }, { status: 400 });
    }
    return Response.json({ error: "admin ingest job proxy failed" }, { status: 500 });
  }
}

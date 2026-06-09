import { buildIssuesCsv, ExportNotAuthenticatedError } from "@/lib/account/export";

// Auth- and cookie-dependent; never cache.
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const csv = await buildIssuesCsv();
    const date = new Date().toISOString().slice(0, 10);
    return new Response(csv, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="vinid-issues-${date}.csv"`,
        "cache-control": "no-store",
      },
    });
  } catch (err) {
    const status = err instanceof ExportNotAuthenticatedError ? 401 : 500;
    return new Response(status === 401 ? "unauthorized" : "export_failed", {
      status,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }
}

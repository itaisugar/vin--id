import { buildUserExport, ExportNotAuthenticatedError } from "@/lib/account/export";

// Auth- and cookie-dependent; never cache.
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const data = await buildUserExport();
    const date = new Date().toISOString().slice(0, 10);
    return new Response(JSON.stringify(data, null, 2), {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "content-disposition": `attachment; filename="vinid-export-${date}.json"`,
        "cache-control": "no-store",
      },
    });
  } catch (err) {
    const status = err instanceof ExportNotAuthenticatedError ? 401 : 500;
    return new Response(
      JSON.stringify({ error: status === 401 ? "unauthorized" : "export_failed" }),
      { status, headers: { "content-type": "application/json" } },
    );
  }
}

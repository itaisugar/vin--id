import { NextResponse, type NextRequest } from "next/server";
import { getDocumentSignedUrl } from "@/lib/documents/service";

// Auth + signed URL must be evaluated per request; never cache.
export const dynamic = "force-dynamic";

/**
 * Opens the original document file in a new tab via a short-lived, server-issued
 * signed URL. Used by the "View document" button on record cards (maintenance,
 * etc.). Reuses `getDocumentSignedUrl`, which verifies ownership before signing
 * and returns null for a missing/deleted/not-owned document — in which case we
 * fall back to the document detail page instead of crashing.
 *
 * `storage_path` is never exposed to the client: only the signed URL (the
 * intended access mechanism) leaves the server, via a redirect.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; documentId: string }> },
) {
  const { id, documentId } = await params;

  const signedUrl = await getDocumentSignedUrl(id, documentId);
  if (signedUrl) {
    return NextResponse.redirect(signedUrl);
  }

  // No file (deleted / not owned / never persisted): send the user to the
  // document detail page, which renders its own not-available state.
  return NextResponse.redirect(
    new URL(`/vehicles/${id}/documents/${documentId}`, _request.nextUrl.origin),
  );
}

import { NextResponse, type NextRequest } from "next/server";
import { DRIVER_HOME } from "@/lib/drivers/guard";
import { getDriverDocumentSignedUrl } from "@/lib/drivers/service";

// Auth + signed URL must be evaluated per request; never cache.
export const dynamic = "force-dynamic";

/**
 * Opens a document a manager shared with the assigned driver, via a short-lived,
 * server-issued signed URL.
 *
 * Deliberately takes NO vehicle id. `getDriverDocumentSignedUrl` resolves the
 * Storage path through `get_driver_document_path()`, which re-applies the whole
 * driver rule server-side: the document must be driver_visible, attached to the
 * caller's ACTIVE assignment, and not deleted. A guessed document id, a document
 * from another vehicle, or an unshared invoice on the driver's own vehicle all
 * resolve to NULL, so no URL is signed and the driver is sent back to their
 * screen. `storage_path` never reaches the browser.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ documentId: string }> },
) {
  const { documentId } = await params;

  const signedUrl = await getDriverDocumentSignedUrl(documentId);
  if (signedUrl) {
    return NextResponse.redirect(signedUrl);
  }

  return NextResponse.redirect(new URL(DRIVER_HOME, request.nextUrl.origin));
}

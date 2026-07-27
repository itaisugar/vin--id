import "server-only";

import {
  requireFleetWriter,
  requireOrganization,
} from "@/lib/organizations/service";
import { createClient } from "@/lib/supabase/server";
import { getVehicleById } from "@/lib/vehicles/service";
import {
  DOCUMENT_COLUMNS,
  DOCUMENTS_BUCKET,
  metadataToRow,
  type DocumentCreateInput,
  type DocumentMetadataInput,
  type VehicleDocument,
} from "./types";

/**
 * Server-only data access for vehicle documents. Relies on Supabase RLS
 * (organization-scoped DB policies) AND additionally filters by organization_id.
 *
 * Storage access is now ORGANIZATION-AWARE (migration
 * 20260725120000_document_storage_org_access): the private-bucket object
 * policies authorize by the document ROW's organization, not by the uploader's
 * uid, so any authorized member of the organization can open the file. Reads are
 * allowed for every member (viewers included); object writes/removes require an
 * org writer. Signed URLs are still created only after `getDocument`
 * (org-scoped) authorizes the request, and the path always comes from the DB row
 * — never from the client. See docs/fleet-lite-document-storage.md.
 */

export class VehicleNotFoundError extends Error {
  constructor() {
    super("Vehicle not found");
    this.name = "VehicleNotFoundError";
  }
}

export class DocumentNotFoundError extends Error {
  constructor() {
    super("Document not found");
    this.name = "DocumentNotFoundError";
  }
}

export class InvalidStoragePathError extends Error {
  constructor() {
    super("Invalid storage path");
    this.name = "InvalidStoragePathError";
  }
}

/** All non-deleted documents for a vehicle, newest first. */
export async function listDocuments(
  vehicleId: string,
): Promise<VehicleDocument[]> {
  const supabase = await createClient();
  const { organizationId } = await requireOrganization();

  const { data, error } = await supabase
    .from("vehicle_documents")
    .select(DOCUMENT_COLUMNS)
    .eq("vehicle_id", vehicleId)
    .eq("organization_id", organizationId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false });

  if (error) throw error;
  return (data ?? []) as VehicleDocument[];
}

/** A single non-deleted document for a vehicle owned by the user, or null. */
export async function getDocument(
  vehicleId: string,
  documentId: string,
): Promise<VehicleDocument | null> {
  const supabase = await createClient();
  const { organizationId } = await requireOrganization();

  const { data, error } = await supabase
    .from("vehicle_documents")
    .select(DOCUMENT_COLUMNS)
    .eq("id", documentId)
    .eq("vehicle_id", vehicleId)
    .eq("organization_id", organizationId)
    .is("deleted_at", null)
    .maybeSingle();

  if (error) throw error;
  return (data as VehicleDocument | null) ?? null;
}

/**
 * Insert the metadata row for a file already uploaded to Storage by the client.
 * Verifies vehicle ownership and that the storage path is inside the user's own
 * folder for this vehicle/document.
 */
export async function createDocument(
  vehicleId: string,
  input: DocumentCreateInput,
): Promise<string> {
  const supabase = await createClient();
  // Uploading a document is a WRITE — viewers are rejected here with a clear
  // error (the vehicle_documents RLS insert policy enforces the same rule).
  const { userId } = await requireFleetWriter();

  const vehicle = await getVehicleById(vehicleId);
  if (!vehicle) throw new VehicleNotFoundError();

  // Defense in depth: the path must live under {userId}/{vehicleId}/{documentId}/
  const expectedPrefix = `${userId}/${vehicleId}/${input.documentId}/`;
  if (!input.storage_path.startsWith(expectedPrefix)) {
    throw new InvalidStoragePathError();
  }

  const { error } = await supabase.from("vehicle_documents").insert({
    id: input.documentId,
    vehicle_id: vehicleId,
    owner_user_id: userId,
    storage_path: input.storage_path,
    file_name: input.file_name,
    mime_type: input.mime_type,
    file_size: input.file_size,
    ...metadataToRow(input),
  });

  if (error) throw error;
  return input.documentId;
}

/** Update editable metadata only (never the file or storage path). */
export async function updateDocument(
  vehicleId: string,
  documentId: string,
  meta: DocumentMetadataInput,
): Promise<void> {
  const supabase = await createClient();
  const { organizationId } = await requireFleetWriter();

  const existing = await getDocument(vehicleId, documentId);
  if (!existing) throw new DocumentNotFoundError();

  const { error } = await supabase
    .from("vehicle_documents")
    .update(metadataToRow(meta))
    .eq("id", documentId)
    .eq("vehicle_id", vehicleId)
    .eq("organization_id", organizationId)
    .is("deleted_at", null);

  if (error) throw error;
}

/**
 * Soft delete a document AND remove its Storage object.
 *
 * Order and consistency:
 *   1. Authorize (writer + org-scoped getDocument). A viewer or a member of
 *      another organization is rejected before anything changes.
 *   2. Soft-delete the metadata row (deleted_at). The row remains the source of
 *      truth and disappears from every list immediately.
 *   3. Best-effort remove the Storage object. The object-delete RLS policy
 *      (`can_write_document_object`) allows a writer whose org owns the row —
 *      including just-soft-deleted rows — so a colleague's upload can be
 *      removed. If removal fails the metadata is still deleted; we log the
 *      orphaned path (never silently) and report it via the return value.
 *
 * Passport safety: passport snapshots copy document METADATA only (storage_path
 * is NULL on accepted copies), so removing a seller's object never breaks a
 * buyer — the buyer never referenced the file.
 *
 * Returns whether the physical object was removed, so callers can surface a
 * "file could not be removed" notice without failing the delete.
 */
export async function softDeleteDocument(
  vehicleId: string,
  documentId: string,
): Promise<{ objectRemoved: boolean }> {
  const supabase = await createClient();
  const { organizationId } = await requireFleetWriter();

  // Authorize + capture the trusted path from the DB row (never from a client).
  const existing = await getDocument(vehicleId, documentId);
  if (!existing) throw new DocumentNotFoundError();

  const { error } = await supabase
    .from("vehicle_documents")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", documentId)
    .eq("vehicle_id", vehicleId)
    .eq("organization_id", organizationId)
    .is("deleted_at", null);

  if (error) throw error;

  if (!existing.storage_path) return { objectRemoved: false };

  const { error: removeError } = await supabase.storage
    .from(DOCUMENTS_BUCKET)
    .remove([existing.storage_path]);

  if (removeError) {
    // Not silent: record the orphaned object so it can be reconciled. No secret
    // is logged — only the internal storage path.
    console.error("[documents] metadata soft-deleted but object remove failed", {
      documentId,
      vehicleId,
      storage_path: existing.storage_path,
      reason: removeError.message,
    });
    return { objectRemoved: false };
  }

  return { objectRemoved: true };
}

/**
 * Create a short-lived signed URL for viewing/downloading a document file.
 *
 * Authorization is server-side and by DOCUMENT ID, never by a client-supplied
 * path: `getDocument` is organization-scoped, so a document in another
 * organization returns null and nothing is ever signed. The storage_path is
 * read from the DB row. The org-aware object RLS is a second, independent gate
 * (the caller's own JWT must also pass `can_read_document_object`). Any
 * authorized org member — viewers included — can obtain a URL; it is short-lived
 * (default 300s) and never persisted.
 */
export async function getDocumentSignedUrl(
  vehicleId: string,
  documentId: string,
  expiresInSeconds = 300,
): Promise<string | null> {
  const supabase = await createClient();
  // Assert an organization context before signing anything. `getDocument` is
  // itself organization-scoped, so a document belonging to another organization
  // returns null here and no URL is ever signed for it.
  await requireOrganization();

  const doc = await getDocument(vehicleId, documentId);
  if (!doc || !doc.storage_path) return null;

  const { data, error } = await supabase.storage
    .from(DOCUMENTS_BUCKET)
    .createSignedUrl(doc.storage_path, expiresInSeconds);

  if (error) return null;
  return data?.signedUrl ?? null;
}

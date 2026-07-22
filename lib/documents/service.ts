import "server-only";

import { requireOrganization } from "@/lib/organizations/service";
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
 * NOTE: Storage paths are still keyed on the UPLOADING USER's id, not the
 * organization — see docs/fleet-lite-phase-1.md "Known limitations".
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
  const { userId } = await requireOrganization();

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
  const { organizationId } = await requireOrganization();

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
 * Soft delete: set deleted_at. The Storage file is intentionally left in place
 * for MVP.
 * TODO(storage-cleanup): remove the object from the `vehicle-documents` bucket
 * (and handle Passport snapshot references) when hardening delete.
 */
export async function softDeleteDocument(
  vehicleId: string,
  documentId: string,
): Promise<void> {
  const supabase = await createClient();
  const { organizationId } = await requireOrganization();

  const { error } = await supabase
    .from("vehicle_documents")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", documentId)
    .eq("vehicle_id", vehicleId)
    .eq("organization_id", organizationId)
    .is("deleted_at", null);

  if (error) throw error;
}

/**
 * Create a short-lived signed URL for viewing/downloading a document file.
 * Ownership is verified before signing; the storage RLS also restricts it.
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

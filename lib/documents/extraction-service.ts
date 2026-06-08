import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { NotAuthenticatedError } from "@/lib/vehicles/service";
import { runMockDocumentExtraction } from "@/lib/server/ai/mock-document-extraction";
import { getDocument } from "./service";
import {
  type ConfirmExtractionInput,
  type DocumentExtraction,
} from "./extraction-types";

/**
 * Server-only document extraction (MOCK). Relies on Supabase RLS (owner-scoped)
 * AND verifies the document/extraction belong to the user. Extraction is NEVER
 * auto-applied — it is saved as pending and the user must confirm.
 */

export class DocumentNotFoundError extends Error {
  constructor() {
    super("Document not found");
    this.name = "DocumentNotFoundError";
  }
}
export class ExtractionNotFoundError extends Error {
  constructor() {
    super("Extraction not found");
    this.name = "ExtractionNotFoundError";
  }
}

const EXTRACTION_COLUMNS =
  "id, document_id, status, extracted_data, created_at";

async function getUserId(supabase: SupabaseClient): Promise<string> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new NotAuthenticatedError();
  return user.id;
}

/** The latest pending extraction for a document (the one under review), or null. */
export async function getLatestPendingExtraction(
  documentId: string,
): Promise<DocumentExtraction | null> {
  const supabase = await createClient();
  const userId = await getUserId(supabase);

  const { data, error } = await supabase
    .from("document_extractions")
    .select(EXTRACTION_COLUMNS)
    .eq("document_id", documentId)
    .eq("owner_user_id", userId)
    .eq("status", "pending_confirmation")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return (data as DocumentExtraction | null) ?? null;
}

/**
 * Run the mock extraction for a document the user owns. Replaces any existing
 * pending extraction for that document. Returns the new extraction id.
 */
export async function runExtraction(
  vehicleId: string,
  documentId: string,
): Promise<string> {
  const supabase = await createClient();
  const userId = await getUserId(supabase);

  const doc = await getDocument(vehicleId, documentId);
  if (!doc) throw new DocumentNotFoundError();

  const result = runMockDocumentExtraction({
    docType: doc.doc_type,
    fileName: doc.file_name,
    existingDocumentDate: doc.document_date,
  });

  // Keep a single pending extraction per document.
  await supabase
    .from("document_extractions")
    .delete()
    .eq("document_id", documentId)
    .eq("owner_user_id", userId)
    .eq("status", "pending_confirmation");

  const { data, error } = await supabase
    .from("document_extractions")
    .insert({
      owner_user_id: userId,
      document_id: documentId,
      vehicle_id: vehicleId,
      status: "pending_confirmation",
      engine: "mock",
      extracted_data: result,
    })
    .select("id")
    .single();

  if (error) throw error;
  return data.id as string;
}

/**
 * Apply confirmed fields to the document and mark the extraction confirmed.
 * Updates ONLY the six metadata fields — never share_allowed,
 * contains_personal_info, or trust_label.
 */
export async function confirmExtraction(
  extractionId: string,
  input: ConfirmExtractionInput,
): Promise<{ vehicleId: string | null; documentId: string }> {
  const supabase = await createClient();
  const userId = await getUserId(supabase);

  const { data: extraction, error: exErr } = await supabase
    .from("document_extractions")
    .select("id, document_id, vehicle_id, status")
    .eq("id", extractionId)
    .eq("owner_user_id", userId)
    .maybeSingle();
  if (exErr) throw exErr;
  if (!extraction) throw new ExtractionNotFoundError();

  const documentId = extraction.document_id as string;

  // Update only the confirmed metadata fields on the owner's document.
  const { error: docErr } = await supabase
    .from("vehicle_documents")
    .update({
      doc_type: input.document_type,
      document_date: input.document_date ?? null,
      expiry_date: input.expiry_date ?? null,
      vendor: input.vendor ?? null,
      amount: input.amount ?? null,
      currency: input.currency,
    })
    .eq("id", documentId)
    .eq("owner_user_id", userId)
    .is("deleted_at", null);
  if (docErr) throw docErr;

  const { error: updErr } = await supabase
    .from("document_extractions")
    .update({
      status: "confirmed",
      confirmed_data: input,
      confirmed_at: new Date().toISOString(),
    })
    .eq("id", extractionId)
    .eq("owner_user_id", userId);
  if (updErr) throw updErr;

  return {
    vehicleId: (extraction.vehicle_id as string | null) ?? null,
    documentId,
  };
}

/** Discard a pending extraction (no change to the document). */
export async function discardExtraction(extractionId: string): Promise<void> {
  const supabase = await createClient();
  const userId = await getUserId(supabase);

  const { error } = await supabase
    .from("document_extractions")
    .update({ status: "discarded" })
    .eq("id", extractionId)
    .eq("owner_user_id", userId)
    .eq("status", "pending_confirmation");
  if (error) throw error;
}

"use server";

import { revalidatePath } from "next/cache";
import {
  confirmExtraction,
  discardExtraction,
  runExtraction,
} from "@/lib/documents/extraction-service";
import { confirmExtractionSchema } from "@/lib/documents/extraction-types";

/**
 * Failure state for extraction actions. `error` is a translation key (under
 * `documents.extraction.errors`). These actions revalidate the document detail
 * page rather than redirect, so the review panel updates in place.
 */
export type ExtractionActionState = { error?: string };

function revalidateDoc(vehicleId: string, documentId: string) {
  revalidatePath(`/vehicles/${vehicleId}/documents/${documentId}`);
}

export async function extractDocumentAction(
  vehicleId: string,
  documentId: string,
): Promise<ExtractionActionState> {
  try {
    await runExtraction(vehicleId, documentId);
  } catch {
    return { error: "extractFailed" };
  }
  revalidateDoc(vehicleId, documentId);
  return {};
}

export async function confirmExtractionAction(
  vehicleId: string,
  documentId: string,
  extractionId: string,
  values: unknown,
): Promise<ExtractionActionState> {
  const parsed = confirmExtractionSchema.safeParse(values);
  if (!parsed.success) return { error: "confirmFailed" };

  try {
    await confirmExtraction(extractionId, parsed.data);
  } catch {
    return { error: "confirmFailed" };
  }
  revalidateDoc(vehicleId, documentId);
  revalidatePath(`/vehicles/${vehicleId}/documents`);
  return {};
}

export async function discardExtractionAction(
  vehicleId: string,
  documentId: string,
  extractionId: string,
): Promise<ExtractionActionState> {
  try {
    await discardExtraction(extractionId);
  } catch {
    return { error: "discardFailed" };
  }
  revalidateDoc(vehicleId, documentId);
  return {};
}

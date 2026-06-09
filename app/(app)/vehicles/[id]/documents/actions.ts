"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import * as z from "zod";
import { trackEvent } from "@/lib/analytics/track";
import {
  createDocument,
  softDeleteDocument,
  updateDocument,
} from "@/lib/documents/service";
import {
  documentCreateSchema,
  documentMetadataSchema,
} from "@/lib/documents/types";

/**
 * Failure state returned to the client form. `fieldErrors`/`error` values are
 * translation keys (under `documents.form.errors`). On success, create/update
 * redirect; delete returns undefined and relies on revalidation.
 */
export type DocumentActionState = {
  error?: string;
  fieldErrors?: Partial<Record<string, string>>;
};

function toFieldErrors(error: z.ZodError): DocumentActionState {
  const flattened = z.flattenError(error).fieldErrors as Record<
    string,
    string[] | undefined
  >;
  const fieldErrors: Record<string, string> = {};
  for (const [key, messages] of Object.entries(flattened)) {
    if (messages && messages.length > 0) fieldErrors[key] = messages[0];
  }
  return { fieldErrors };
}

function revalidateVehicle(vehicleId: string) {
  revalidatePath(`/vehicles/${vehicleId}`);
  revalidatePath(`/vehicles/${vehicleId}/documents`);
}

/**
 * Persist metadata for a file the client already uploaded to Storage. The file
 * descriptor (storage_path/mime/size) is validated and the path ownership is
 * re-checked server-side. Returns an error so the client can clean up the
 * orphaned upload.
 */
export async function createDocumentAction(
  vehicleId: string,
  values: unknown,
): Promise<DocumentActionState> {
  const parsed = documentCreateSchema.safeParse(values);
  if (!parsed.success) return toFieldErrors(parsed.error);

  try {
    await createDocument(vehicleId, parsed.data);
  } catch {
    return { error: "saveFailed" };
  }

  // file_type is coarse (pdf/image) — never the filename, which may be personal.
  await trackEvent({
    eventName: "document_uploaded",
    entityType: "document",
    entityId: parsed.data.documentId,
    vehicleId,
    metadata: {
      file_type: parsed.data.mime_type === "application/pdf" ? "pdf" : "image",
      doc_type: parsed.data.document_type,
    },
  });

  revalidateVehicle(vehicleId);
  redirect(`/vehicles/${vehicleId}/documents`);
}

export async function updateDocumentAction(
  vehicleId: string,
  documentId: string,
  values: unknown,
): Promise<DocumentActionState> {
  const parsed = documentMetadataSchema.safeParse(values);
  if (!parsed.success) return toFieldErrors(parsed.error);

  try {
    await updateDocument(vehicleId, documentId, parsed.data);
  } catch {
    return { error: "saveFailed" };
  }

  revalidateVehicle(vehicleId);
  redirect(`/vehicles/${vehicleId}/documents`);
}

export async function deleteDocumentAction(
  vehicleId: string,
  documentId: string,
): Promise<DocumentActionState> {
  try {
    await softDeleteDocument(vehicleId, documentId);
  } catch {
    return { error: "deleteFailed" };
  }

  revalidateVehicle(vehicleId);
  return {};
}

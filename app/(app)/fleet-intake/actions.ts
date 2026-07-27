"use server";

import { revalidatePath } from "next/cache";
import { getLocale } from "next-intl/server";
import { isScanImageMime, MAX_SCAN_FILE_SIZE } from "@/lib/documents/scan/types";
import { DOCUMENTS_BUCKET } from "@/lib/documents/types";
import {
  cancelIntake,
  confirmIntake,
  findDuplicateDocuments,
  hashFileContent,
  matchVehicle,
  runFleetExtraction,
} from "@/lib/fleet-intake/service";
import {
  intakeConfirmSchema,
  type DuplicateDocument,
  type IntakeErrorKey,
} from "@/lib/fleet-intake/types";
import { requireFleetWriter } from "@/lib/organizations/service";
import { createClient } from "@/lib/supabase/server";

/**
 * Server actions for Fleet document intake.
 *
 * NONE of these creates an operational record except `confirmIntakeAction`,
 * which delegates to `confirm_fleet_intake()`. Uploading and extracting are
 * deliberately inert: they put a file in Storage and a reviewable row in
 * `document_extractions`, and change nothing a Fleet manager would see on the
 * dashboard.
 *
 * Authorization is checked here AND again in the service AND again in the
 * database. The UI check is a convenience; the database is the boundary.
 */

export type IntakeUploadState =
  | { ok: true; intakeId: string; duplicates: DuplicateDocument[] }
  | { ok: false; error: IntakeErrorKey };

export type IntakeConfirmState =
  | { ok: true; vehicleId: string; recordType: string }
  | { ok: false; error: IntakeErrorKey };

/**
 * Upload a document image and extract it.
 *
 * `vehicleId` is optional: the Fleet Dashboard entry point has no vehicle yet
 * and lets matching propose one. When it IS supplied (the vehicle-detail entry
 * point) the server still re-verifies access — a client-supplied id is a
 * suggestion, never an authorization.
 */
export async function uploadAndExtractAction(
  formData: FormData,
): Promise<IntakeUploadState> {
  try {
    await requireFleetWriter();
  } catch {
    return { ok: false, error: "notAuthorized" };
  }

  const file = formData.get("file");
  const vehicleIdRaw = String(formData.get("vehicleId") ?? "").trim();
  const vehicleId = vehicleIdRaw || null;

  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: "fileRequired" };
  }
  if (!isScanImageMime(file.type)) {
    // PDF is deliberately excluded: the extraction provider is given an image
    // block, and claiming PDF support without testing it would be a lie.
    return { ok: false, error: "invalidFileType" };
  }
  if (file.size > MAX_SCAN_FILE_SIZE) {
    return { ok: false, error: "fileTooLarge" };
  }

  const { userId, organizationId } = await requireFleetWriter();
  const supabase = await createClient();
  const buffer = Buffer.from(await file.arrayBuffer());
  const contentHash = hashFileContent(buffer);

  // The Storage path is built SERVER-SIDE from the uploader's id and random
  // bytes. The client never proposes a path, so it cannot aim an upload at
  // another user's folder or collide with an existing object.
  const extension = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
  const storagePath = `${userId}/${crypto.randomUUID()}.${extension}`;

  const { error: uploadError } = await supabase.storage
    .from(DOCUMENTS_BUCKET)
    .upload(storagePath, buffer, { contentType: file.type, upsert: false });
  if (uploadError) {
    console.error("[fleet-intake] upload failed:", { code: uploadError.name });
    return { ok: false, error: "uploadFailed" };
  }

  const locale = await getLocale();

  // Vehicle-detail entry: a document row already exists for this vehicle, so
  // intake attaches to it. Dashboard entry: no vehicle yet, so the descriptor
  // is parked on the intake row and the document is created at confirmation.
  let documentId: string | null = null;
  if (vehicleId) {
    const { data: doc, error: docError } = await supabase
      .from("vehicle_documents")
      .insert({
        owner_user_id: userId,
        organization_id: organizationId,
        vehicle_id: vehicleId,
        doc_type: "other",
        file_name: file.name.slice(0, 200),
        mime_type: file.type,
        file_size: file.size,
        storage_path: storagePath,
        content_hash: contentHash,
        trust_label: "ai_extracted",
        contains_personal_info: true,
        share_allowed: false,
      })
      .select("id")
      .single();

    if (docError || !doc) {
      // The object is already in Storage. Remove it rather than leaving an
      // orphan no row will ever reference.
      await supabase.storage.from(DOCUMENTS_BUCKET).remove([storagePath]);
      return { ok: false, error: "uploadFailed" };
    }
    documentId = doc.id as string;
  }

  const duplicates = await findDuplicateDocuments(contentHash);

  const result = await runFleetExtraction({
    documentId: documentId ?? "",
    vehicleId,
    image: { buffer, mimeType: file.type },
    contentHash,
    locale,
    pending: documentId
      ? null
      : {
          storage_path: storagePath,
          file_name: file.name.slice(0, 200),
          mime_type: file.type,
          file_size: file.size,
        },
  });

  if (!result.ok) {
    return { ok: false, error: result.error as IntakeErrorKey };
  }
  return { ok: true, intakeId: result.intakeId, duplicates };
}

/** Re-run matching for an intake after the user edits the identifiers. */
export async function rematchAction(
  vin: string | null,
  registration: string | null,
  preselectedVehicleId: string | null,
) {
  try {
    await requireFleetWriter();
  } catch {
    return null;
  }
  return matchVehicle(
    {
      document_category: "unknown",
      confidence: null,
      vin: vin?.trim() || null,
      vehicle_registration: registration?.trim() || null,
    },
    preselectedVehicleId,
  );
}

/**
 * The explicit confirmation. This is the only action that creates a record.
 */
export async function confirmIntakeAction(
  _prev: IntakeConfirmState,
  formData: FormData,
): Promise<IntakeConfirmState> {
  const raw = Object.fromEntries(formData.entries());
  const parsed = intakeConfirmSchema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0]?.message;
    return {
      ok: false,
      error: (first as IntakeErrorKey) ?? "invalidPayload",
    };
  }

  const result = await confirmIntake(parsed.data);
  if (!result.ok) return { ok: false, error: result.error };

  revalidatePath("/dashboard");
  revalidatePath(`/vehicles/${result.vehicleId}`);
  return {
    ok: true,
    vehicleId: result.vehicleId,
    recordType: result.recordType,
  };
}

/** Abandon a review. Nothing was persisted, so nothing is undone. */
export async function cancelIntakeAction(intakeId: string): Promise<boolean> {
  const ok = await cancelIntake(intakeId);
  if (ok) revalidatePath("/fleet-intake");
  return ok;
}

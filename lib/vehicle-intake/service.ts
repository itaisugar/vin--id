import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { NotAuthorizedError, OrganizationMissingError } from "@/lib/auth/errors";
import { DOCUMENTS_BUCKET } from "@/lib/documents/types";
import { isScanImageMime, MAX_SCAN_FILE_SIZE, type ScanImageMime } from "@/lib/documents/scan/types";
import { requireFleetWriter, requireOrganization } from "@/lib/organizations/service";
import { createClient } from "@/lib/supabase/server";
import { getVehicleExtractionProvider, VehicleExtractionError } from "./provider";
import { ExtractionUnavailableError } from "@/lib/server/ai/provider-mode";
import type { VehicleRegistrationExtraction } from "./extraction-types";

/**
 * Vehicle-registration AI intake — server-only orchestration.
 *
 * Reuses the existing intake table (`document_extractions`), the private
 * documents bucket, and the provider abstraction. Nothing here creates a
 * vehicle: `confirmRegistrationIntake()` delegates to
 * `confirm_vehicle_registration_intake()`, the single atomic write point.
 */

const MAX_EDGE = 1500;

export type IntakeErrorKey =
  | "notAuthorized"
  | "fileRequired"
  | "invalidFileType"
  | "fileTooLarge"
  | "uploadFailed"
  | "extractFailed"
  | "extractUnavailable"
  | "saveFailed";

export interface RegistrationIntakeRecord {
  id: string;
  status: string;
  extraction: VehicleRegistrationExtraction | null;
  engine: string;
}

const INTAKE_COLUMNS = "id, status, engine, extracted_data";

export function hashFileContent(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

/**
 * Upload a registration image, extract it, and stage a pending intake row.
 * Requires a Fleet WRITER (same as vehicle creation): extraction costs money and
 * only someone who could create the vehicle should be able to run it.
 */
export async function createRegistrationIntake(
  file: unknown,
  locale?: string,
): Promise<
  | { ok: true; intakeId: string; extraction: VehicleRegistrationExtraction; engine: string }
  | { ok: false; error: IntakeErrorKey }
> {
  let ctx;
  try {
    ctx = await requireFleetWriter();
  } catch (error) {
    if (error instanceof NotAuthorizedError || error instanceof OrganizationMissingError) {
      return { ok: false, error: "notAuthorized" };
    }
    throw error;
  }

  if (!(file instanceof File) || file.size === 0) return { ok: false, error: "fileRequired" };
  if (!isScanImageMime(file.type)) return { ok: false, error: "invalidFileType" };
  if (file.size > MAX_SCAN_FILE_SIZE) return { ok: false, error: "fileTooLarge" };

  // Resolve the provider BEFORE uploading. In production a missing/invalid AI
  // configuration returns an explicit unavailable state (no upload, no synthetic
  // extraction, no mock) — the user can retry, replace the image, continue
  // manually, or cancel. Only the reason is logged, never document content.
  let provider;
  try {
    provider = getVehicleExtractionProvider();
  } catch (err) {
    if (err instanceof ExtractionUnavailableError) {
      console.error("[vehicle-intake] extraction unavailable:", { reason: err.reason });
      return { ok: false, error: "extractUnavailable" };
    }
    throw err;
  }

  const { userId, organizationId } = ctx;
  const supabase = await createClient();
  const buffer = Buffer.from(await file.arrayBuffer());
  const contentHash = hashFileContent(buffer);

  // Server-built path — the client never proposes a Storage path.
  const ext = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
  const storagePath = `${userId}/${randomUUID()}.${ext}`;

  const { error: uploadError } = await supabase.storage
    .from(DOCUMENTS_BUCKET)
    .upload(storagePath, buffer, { contentType: file.type, upsert: false });
  if (uploadError) {
    console.error("[vehicle-intake] upload failed:", { code: uploadError.name });
    return { ok: false, error: "uploadFailed" };
  }

  // Downscale before sending to the provider (cost control).
  const { default: sharp } = await import("sharp");
  let downscaled: Buffer;
  try {
    downscaled = await sharp(buffer)
      .rotate()
      .resize({ width: MAX_EDGE, height: MAX_EDGE, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 80 })
      .toBuffer();
  } catch {
    await supabase.storage.from(DOCUMENTS_BUCKET).remove([storagePath]);
    return { ok: false, error: "extractFailed" };
  }

  let extraction: VehicleRegistrationExtraction;
  try {
    extraction = await provider.extract({
      imageBase64: downscaled.toString("base64"),
      mediaType: "image/jpeg" as ScanImageMime,
      locale,
    });
  } catch (err) {
    // Record the failure as an intake row so the user can retry; never store the
    // provider's raw response (it can echo document content).
    await supabase.from("document_extractions").insert({
      owner_user_id: userId,
      organization_id: organizationId,
      status: "failed",
      source: "vehicle_registration",
      engine: provider.engine,
      provider_model: provider.model,
      extracted_data: {},
      content_hash: contentHash,
      pending_storage_path: storagePath,
      pending_file_name: file.name.slice(0, 200),
      pending_mime_type: file.type,
      pending_file_size: file.size,
      error: err instanceof VehicleExtractionError ? err.reason : "provider_error",
    });
    return { ok: false, error: "extractFailed" };
  }

  const { data, error } = await supabase
    .from("document_extractions")
    .insert({
      owner_user_id: userId,
      organization_id: organizationId,
      status: "pending_confirmation",
      source: "vehicle_registration",
      engine: provider.engine,
      provider_model: provider.model,
      extracted_data: extraction,
      category_confidence: extraction.document_type_confidence,
      content_hash: contentHash,
      pending_storage_path: storagePath,
      pending_file_name: file.name.slice(0, 200),
      pending_mime_type: file.type,
      pending_file_size: file.size,
    })
    .select("id")
    .single();

  if (error) {
    console.error("[vehicle-intake] intake insert failed:", { code: error.code });
    return { ok: false, error: "saveFailed" };
  }
  return { ok: true, intakeId: data.id as string, extraction, engine: provider.engine };
}

/** One intake, org-scoped by RLS. */
export async function getRegistrationIntake(
  intakeId: string,
): Promise<RegistrationIntakeRecord | null> {
  const supabase = await createClient();
  const { organizationId } = await requireOrganization();
  const { data, error } = await supabase
    .from("document_extractions")
    .select(INTAKE_COLUMNS)
    .eq("id", intakeId)
    .eq("organization_id", organizationId)
    .eq("source", "vehicle_registration")
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    id: data.id as string,
    status: data.status as string,
    engine: data.engine as string,
    extraction: (data.extracted_data as VehicleRegistrationExtraction) ?? null,
  };
}

export interface ConfirmRegistrationInput {
  intakeId: string;
  vehicle: {
    make?: string;
    model?: string;
    year?: string;
    vin?: string;
    license_plate?: string;
    color?: string;
    fuel_type?: string;
    test_expiry_date?: string;
  };
  usedGovernment: boolean;
  government?: { fetched_at?: string | null; resource_id?: string | null } | null;
  createReminder?: boolean;
  reminderLeadDays?: number;
}

export type ConfirmRegistrationResult =
  | { ok: true; vehicleId: string; documentId: string | null; alreadyConfirmed: boolean }
  | { ok: false; error: string; existingVehicleId?: string };

/**
 * Confirm an intake → create exactly one vehicle. All authorization, the
 * duplicate check, atomicity and idempotency are enforced by the RPC.
 */
export async function confirmRegistrationIntake(
  input: ConfirmRegistrationInput,
): Promise<ConfirmRegistrationResult> {
  try {
    await requireFleetWriter();
  } catch (error) {
    if (error instanceof NotAuthorizedError || error instanceof OrganizationMissingError) {
      return { ok: false, error: "notAuthorized" };
    }
    throw error;
  }

  const supabase = await createClient();
  const dataSource = input.usedGovernment ? "mixed_confirmed" : "vehicle_registration_ai";

  const { data, error } = await supabase.rpc("confirm_vehicle_registration_intake", {
    p_extraction: input.intakeId,
    p_vehicle: input.vehicle,
    p_data_source: dataSource,
    p_government: input.usedGovernment && input.government
      ? { fetched_at: input.government.fetched_at ?? null, resource_id: input.government.resource_id ?? null }
      : null,
    p_create_reminder: Boolean(input.createReminder),
    p_reminder_lead_days: input.reminderLeadDays ?? 30,
  });

  if (error) {
    console.error("[vehicle-intake] confirm failed:", { code: error.code });
    return { ok: false, error: "saveFailed" };
  }

  const result = (data ?? {}) as {
    state?: string;
    vehicle_id?: string;
    document_id?: string;
    existing_vehicle_id?: string;
  };

  if (result.state === "ok" || result.state === "already_confirmed") {
    return {
      ok: true,
      vehicleId: result.vehicle_id!,
      documentId: result.document_id ?? null,
      alreadyConfirmed: result.state === "already_confirmed",
    };
  }
  if (result.state === "duplicate") {
    return { ok: false, error: "duplicate", existingVehicleId: result.existing_vehicle_id };
  }
  return { ok: false, error: result.state ?? "saveFailed" };
}

/** Abandon an intake and remove the staged file (best-effort). */
export async function cancelRegistrationIntake(intakeId: string): Promise<boolean> {
  try {
    await requireFleetWriter();
  } catch {
    return false;
  }
  const supabase = await createClient();
  const { organizationId } = await requireOrganization();

  // Read the staged path before cancelling so we can clean it up.
  const { data: row } = await supabase
    .from("document_extractions")
    .select("pending_storage_path, status")
    .eq("id", intakeId)
    .eq("organization_id", organizationId)
    .eq("source", "vehicle_registration")
    .maybeSingle();

  const { error } = await supabase
    .from("document_extractions")
    .update({ status: "cancelled", cancelled_at: new Date().toISOString() })
    .eq("id", intakeId)
    .eq("organization_id", organizationId)
    .in("status", ["pending_confirmation", "failed"]);
  if (error) return false;

  // Only delete the staged object if it was never filed as a real document.
  const stagedPath = (row as { pending_storage_path?: string | null } | null)?.pending_storage_path;
  if (stagedPath) {
    await supabase.storage.from(DOCUMENTS_BUCKET).remove([stagedPath]).catch(() => {});
  }
  return true;
}

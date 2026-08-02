import "server-only";

import { createHash } from "node:crypto";
import {
  NotAuthorizedError,
  OrganizationMissingError,
} from "@/lib/auth/errors";
import { getExtractionProvider } from "@/lib/documents/scan/provider";
import { type ScanExtraction, type ScanImageMime } from "@/lib/documents/scan/types";
import {
  requireFleetWriter,
  requireOrganization,
} from "@/lib/organizations/service";
import { createClient } from "@/lib/supabase/server";
import {
  categoryConfidenceLevel,
  intakeStateToError,
  requiresManualVehicleSelection,
  type DuplicateDocument,
  type FieldProvenance,
  type IntakeConfirmInput,
  type IntakeConfirmResult,
  type IntakeRecord,
  type MatchMethod,
  type VehicleCandidate,
  type VehicleMatchResult,
} from "./types";

/**
 * Fleet AI document intake — server-only orchestration.
 *
 * ONE ENGINE, NOT TWO. Extraction reuses the existing provider abstraction
 * (`lib/documents/scan/provider`), the existing prompt and the existing Zod
 * schema. This module adds only what Fleet needs on top: server-side vehicle
 * matching, duplicate detection, an intake row for provenance, and a call to
 * the atomic confirmation RPC.
 *
 * THE SAFETY RULE. Nothing in this file creates an operational record.
 * `confirmIntake()` delegates to `confirm_fleet_intake()`, which is the only
 * write point and refuses to run twice. Uploading, extracting and reviewing all
 * leave the fleet's data untouched.
 */

/** Longest-edge cap for the downscaled image (px). Keeps token cost bounded. */
const MAX_EDGE = 1500;

const INTAKE_COLUMNS =
  "id, document_id, vehicle_id, status, engine, provider_model, proposed_category, " +
  "category_confidence, confirmed_category, vehicle_match_method, vehicle_candidates, " +
  "extracted_data, confirmed_data, field_provenance, created_record_type, " +
  "created_record_id, confirmed_by, confirmed_at, created_at, content_hash";

/** sha256 of the uploaded bytes, for advisory duplicate detection. */
export function hashFileContent(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

// -----------------------------------------------------------------------------
// Vehicle matching
// -----------------------------------------------------------------------------

/**
 * Resolve a document's vehicle from its extracted identifiers.
 *
 * The candidate query runs in the DATABASE (`match_fleet_vehicles`), scoped to
 * the caller's organization with no organization parameter, so a document can
 * never reach across tenants however convincing its identifiers look.
 *
 * `preselectedVehicleId` is the vehicle-detail entry point. When the extracted
 * identifiers point somewhere else the result is `conflict`, which the UI must
 * make the user resolve explicitly — silently trusting either side would be
 * wrong.
 */
export async function matchVehicle(
  extraction: ScanExtraction,
  preselectedVehicleId?: string | null,
): Promise<VehicleMatchResult> {
  const supabase = await createClient();
  const vin = "vin" in extraction ? extraction.vin : null;
  const registration =
    "vehicle_registration" in extraction ? extraction.vehicle_registration : null;

  const empty = (method: MatchMethod): VehicleMatchResult => ({
    method,
    candidates: [],
    resolvedVehicleId: preselectedVehicleId ?? null,
    conflictsWithPreselected: false,
  });

  if (!vin && !registration) {
    return preselectedVehicleId ? empty("user_selected") : empty("none");
  }

  const { data, error } = await supabase.rpc("match_fleet_vehicles", {
    p_vin: vin,
    p_registration: registration,
  });
  if (error) {
    console.error("[fleet-intake] match_fleet_vehicles failed:", {
      code: error.code,
    });
    return preselectedVehicleId ? empty("user_selected") : empty("none");
  }

  const rows = (data ?? []) as { vehicle_id: string; method: MatchMethod }[];
  if (rows.length === 0) {
    return preselectedVehicleId ? empty("user_selected") : empty("none");
  }

  // Label the candidates. This read is org-scoped by RLS, so it can only ever
  // return vehicles the caller may already see.
  const ids = rows.map((r) => r.vehicle_id);
  const { data: vehicles } = await supabase
    .from("vehicles")
    .select("id, make, model, license_plate")
    .in("id", ids);

  const candidates: VehicleCandidate[] = rows.map((row) => {
    const v = (vehicles ?? []).find((x) => x.id === row.vehicle_id);
    return {
      vehicle_id: row.vehicle_id,
      method: row.method,
      label:
        [v?.make, v?.model].filter(Boolean).join(" ").trim() ||
        row.vehicle_id.slice(0, 8),
      license_plate: v?.license_plate ?? null,
    };
  });

  const method: MatchMethod =
    candidates.length > 1 ? "ambiguous" : candidates[0].method;

  // Extracted identifiers disagree with the vehicle the user opened intake from.
  const conflicts =
    preselectedVehicleId != null &&
    candidates.length > 0 &&
    !candidates.some((c) => c.vehicle_id === preselectedVehicleId);

  if (conflicts) {
    return {
      method: "conflict",
      candidates,
      resolvedVehicleId: null,
      conflictsWithPreselected: true,
    };
  }

  const manual = requiresManualVehicleSelection(method, candidates.length);
  return {
    method,
    candidates,
    resolvedVehicleId: manual ? (preselectedVehicleId ?? null) : candidates[0].vehicle_id,
    conflictsWithPreselected: false,
  };
}

// -----------------------------------------------------------------------------
// Duplicate detection
// -----------------------------------------------------------------------------

/** Other live documents in the organization with identical file content. */
export async function findDuplicateDocuments(
  contentHash: string,
): Promise<DuplicateDocument[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("find_duplicate_documents", {
    p_hash: contentHash,
  });
  if (error) {
    console.error("[fleet-intake] duplicate lookup failed:", { code: error.code });
    return [];
  }
  return (data ?? []) as DuplicateDocument[];
}

// -----------------------------------------------------------------------------
// Extraction
// -----------------------------------------------------------------------------

/**
 * Run extraction for an already-uploaded Fleet document and persist the intake
 * row. Requires a Fleet WRITER: extraction costs money and a viewer must not be
 * able to spend it, quite apart from having no way to confirm the result.
 *
 * Any previous pending intake for the same document is marked `superseded`
 * rather than deleted, so a retry leaves an auditable trail instead of erasing
 * what the model said the first time.
 */
export async function runFleetExtraction(params: {
  /** Empty when the vehicle is not yet known — see `pending`. */
  documentId: string;
  vehicleId?: string | null;
  image: { buffer: Buffer; mimeType: ScanImageMime };
  contentHash: string;
  locale?: string;
  /**
   * Dashboard intake: the file is already in Storage but no document row can
   * exist yet, because `vehicle_documents.vehicle_id` is NOT NULL and the
   * vehicle is exactly what we are trying to work out. The descriptor rides on
   * the intake row until `confirm_fleet_intake()` files it.
   */
  pending?: {
    storage_path: string;
    file_name: string;
    mime_type: string;
    file_size: number;
  } | null;
}): Promise<{ ok: true; intakeId: string } | { ok: false; error: string }> {
  const { userId, organizationId } = await requireFleetWriter();
  const supabase = await createClient();

  // When intake starts from an existing document it must be one this
  // organization owns. RLS already scopes the read; the explicit filter makes
  // the intent local and testable.
  type DocRef = { id: string; vehicle_id: string | null };
  let doc: DocRef | null = null;
  if (params.documentId) {
    const { data } = await supabase
      .from("vehicle_documents")
      .select("id, vehicle_id")
      .eq("id", params.documentId)
      .eq("organization_id", organizationId)
      .is("deleted_at", null)
      .maybeSingle();
    doc = (data as DocRef | null) ?? null;
    if (!doc) return { ok: false, error: "extractionNotFound" };
  } else if (!params.pending) {
    // Neither an existing document nor a pending file: nothing to review.
    return { ok: false, error: "fileRequired" };
  }

  // sharp is imported lazily: it is a native module and the intake page should
  // not pay for it on a request that never extracts.
  const { default: sharp } = await import("sharp");
  let downscaled: Buffer;
  try {
    downscaled = await sharp(params.image.buffer)
      .rotate()
      .resize({
        width: MAX_EDGE,
        height: MAX_EDGE,
        fit: "inside",
        withoutEnlargement: true,
      })
      .jpeg({ quality: 80 })
      .toBuffer();
  } catch {
    return { ok: false, error: "extractFailed" };
  }

  let provider: ReturnType<typeof getExtractionProvider> | null = null;
  let extraction: ScanExtraction;
  try {
    // Resolving the provider can throw when production AI config is missing —
    // caught here and surfaced as a retryable/manual failure, never a mock.
    provider = getExtractionProvider();
    extraction = await provider.extract({
      imageBase64: downscaled.toString("base64"),
      mediaType: "image/jpeg",
      locale: params.locale,
    });
  } catch (err) {
    // Record the FAILURE as an intake row so the user can see and retry it.
    // Only the error CATEGORY is stored — never the provider's raw response,
    // which can echo document content.
    await supabase.from("document_extractions").insert({
      owner_user_id: userId,
      organization_id: organizationId,
      document_id: params.documentId || null,
      vehicle_id: params.vehicleId ?? doc?.vehicle_id ?? null,
      status: "failed",
      source: "fleet_intake",
      engine: provider?.engine ?? "unavailable",
      extracted_data: {},
      content_hash: params.contentHash,
      pending_storage_path: params.pending?.storage_path ?? null,
      pending_file_name: params.pending?.file_name ?? null,
      pending_mime_type: params.pending?.mime_type ?? null,
      pending_file_size: params.pending?.file_size ?? null,
      error: err instanceof Error ? err.name : "provider_error",
    });
    return { ok: false, error: "extractFailed" };
  }

  const match = await matchVehicle(extraction, params.vehicleId ?? doc?.vehicle_id ?? null);

  // Retry / re-extract: retire the previous pending row instead of deleting it,
  // so the trail of what the model said the first time survives. Only possible
  // when intake started from an existing document — a dashboard upload is a new
  // file each time and has nothing to supersede.
  if (params.documentId) {
    await supabase
      .from("document_extractions")
      .update({ status: "superseded" })
      .eq("document_id", params.documentId)
      .eq("organization_id", organizationId)
      .eq("status", "pending_confirmation");
  }

  const { data, error } = await supabase
    .from("document_extractions")
    .insert({
      owner_user_id: userId,
      organization_id: organizationId,
      document_id: params.documentId || null,
      vehicle_id: match.resolvedVehicleId,
      status: "pending_confirmation",
      source: "fleet_intake",
      engine: provider!.engine,
      provider_model: provider!.engine === "anthropic"
        ? (process.env.EXTRACTION_MODEL || "claude-haiku-4-5-20251001")
        : "mock",
      extracted_data: extraction,
      proposed_category: extraction.document_category,
      category_confidence: extraction.confidence,
      vehicle_match_method: match.method,
      vehicle_candidates: match.candidates,
      content_hash: params.contentHash,
      pending_storage_path: params.pending?.storage_path ?? null,
      pending_file_name: params.pending?.file_name ?? null,
      pending_mime_type: params.pending?.mime_type ?? null,
      pending_file_size: params.pending?.file_size ?? null,
    })
    .select("id")
    .single();

  if (error) {
    console.error("[fleet-intake] intake insert failed:", { code: error.code });
    return { ok: false, error: "saveFailed" };
  }
  return { ok: true, intakeId: data.id as string };
}

// -----------------------------------------------------------------------------
// Reads
// -----------------------------------------------------------------------------

/** One intake row, org-scoped by RLS. */
export async function getIntake(intakeId: string): Promise<IntakeRecord | null> {
  const supabase = await createClient();
  const { organizationId } = await requireOrganization();

  const { data, error } = await supabase
    .from("document_extractions")
    .select(INTAKE_COLUMNS)
    .eq("id", intakeId)
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (error) throw error;
  return (data as unknown as IntakeRecord | null) ?? null;
}

/** Intakes still awaiting review, newest first. */
export async function listPendingIntakes(): Promise<IntakeRecord[]> {
  const supabase = await createClient();
  const { organizationId } = await requireOrganization();

  const { data, error } = await supabase
    .from("document_extractions")
    .select(INTAKE_COLUMNS)
    .eq("organization_id", organizationId)
    .eq("source", "fleet_intake")
    .eq("status", "pending_confirmation")
    .order("created_at", { ascending: false })
    .limit(20);

  if (error) throw error;
  return (data ?? []) as unknown as IntakeRecord[];
}

// -----------------------------------------------------------------------------
// Confirmation
// -----------------------------------------------------------------------------

/** Build the per-field record of what the user changed after the model proposed it. */
function buildFieldProvenance(
  extracted: Record<string, unknown>,
  confirmed: Record<string, string | undefined>,
): Record<string, FieldProvenance> {
  const out: Record<string, FieldProvenance> = {};
  // Extraction and form field names differ in two places; map them so the diff
  // compares like with like instead of reporting every field as edited.
  const alias: Record<string, string> = {
    performed_at: "date",
    vendor_name: "garage_name",
    description: "service_details",
  };

  for (const [field, confirmedValue] of Object.entries(confirmed)) {
    const sourceKey = alias[field] ?? field;
    if (!(sourceKey in extracted)) continue;

    const raw = extracted[sourceKey];
    const extractedValue =
      raw == null ? null : typeof raw === "number" ? raw : String(raw);
    const finalValue =
      confirmedValue == null || confirmedValue === "" ? null : confirmedValue;

    out[field] = {
      extracted: extractedValue,
      confirmed: finalValue,
      edited: String(extractedValue ?? "") !== String(finalValue ?? ""),
    };
  }
  return out;
}

/**
 * Confirm an intake: create exactly one operational record.
 *
 * Every authorization and consistency decision is made by
 * `confirm_fleet_intake()` inside a single transaction — this function only
 * shapes the payload and translates the result. In particular it does NOT
 * pre-check "already confirmed" in JavaScript: doing so would be a race, and
 * the RPC's row lock is what actually makes a double-click safe.
 */
export async function confirmIntake(
  input: IntakeConfirmInput,
): Promise<IntakeConfirmResult> {
  try {
    await requireFleetWriter();
  } catch (error) {
    if (
      error instanceof NotAuthorizedError ||
      error instanceof OrganizationMissingError
    ) {
      return { ok: false, error: "notAuthorized" };
    }
    throw error;
  }

  const supabase = await createClient();

  const payload: Record<string, string> = {};
  const put = (key: string, value: string | undefined) => {
    if (value != null && value !== "") payload[key] = value;
  };
  put("performed_at", input.performed_at);
  put("start_date", input.start_date);
  put("end_date", input.end_date);
  put("next_service_date", input.next_service_date);
  put("next_service_km", input.next_service_km);
  put("mileage", input.mileage);
  put("cost", input.cost);
  put("currency", input.currency);
  put("vendor_name", input.vendor_name);
  put("insurer_name", input.insurer_name);
  put("insurance_type", input.insurance_type);
  put("service_type", input.service_type);
  put("description", input.description);
  put("notes", input.notes);

  const { data, error } = await supabase.rpc("confirm_fleet_intake", {
    p_extraction: input.extractionId,
    p_vehicle: input.vehicleId,
    p_category: input.category,
    p_payload: payload,
  });

  if (error) {
    console.error("[fleet-intake] confirm failed:", { code: error.code });
    return { ok: false, error: "saveFailed" };
  }

  const result = data as {
    state?: string;
    record_type?: string;
    record_id?: string;
  } | null;

  if (result?.state !== "ok" && result?.state !== "already_confirmed") {
    return { ok: false, error: intakeStateToError(result?.state) };
  }
  if (!result.record_id || !result.record_type) {
    return { ok: false, error: "saveFailed" };
  }

  // Provenance is written after the transaction, deliberately: it is a record of
  // what the user changed, not a precondition of the record existing. A failure
  // here must never undo a confirmed record, so it is logged and swallowed.
  if (result.state === "ok") {
    const intake = await getIntake(input.extractionId);
    if (intake) {
      const provenance = buildFieldProvenance(intake.extracted_data ?? {}, {
        performed_at: input.performed_at,
        start_date: input.start_date,
        end_date: input.end_date,
        mileage: input.mileage,
        cost: input.cost,
        vendor_name: input.vendor_name,
        insurer_name: input.insurer_name,
        insurance_type: input.insurance_type,
        service_type: input.service_type,
        description: input.description,
        notes: input.notes,
        next_service_date: input.next_service_date,
        next_service_km: input.next_service_km,
      });
      const { error: provErr } = await supabase
        .from("document_extractions")
        .update({ field_provenance: provenance })
        .eq("id", input.extractionId);
      if (provErr) {
        console.error("[fleet-intake] provenance not recorded:", {
          code: provErr.code,
        });
      }
    }
  }

  return {
    ok: true,
    recordType: result.record_type as IntakeConfirmResult extends { recordType: infer T }
      ? T
      : never,
    recordId: result.record_id,
    vehicleId: input.vehicleId,
    alreadyConfirmed: result.state === "already_confirmed",
  };
}

/** Abandon a review. Terminal: a cancelled intake can never be confirmed. */
export async function cancelIntake(intakeId: string): Promise<boolean> {
  try {
    await requireFleetWriter();
  } catch {
    return false;
  }
  const supabase = await createClient();
  const { error } = await supabase
    .from("document_extractions")
    .update({ status: "cancelled", cancelled_at: new Date().toISOString() })
    .eq("id", intakeId)
    .eq("status", "pending_confirmation");
  return !error;
}

export { categoryConfidenceLevel, requiresManualVehicleSelection };

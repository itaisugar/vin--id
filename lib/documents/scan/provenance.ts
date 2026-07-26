import "server-only";

import { requireFleetWriter } from "@/lib/organizations/service";
import { createClient } from "@/lib/supabase/server";
import type { ScanConfirmFormValues, ScanExtraction, ScanFormCategory } from "./types";

/**
 * Provenance for the "Scan a document" flow.
 *
 * WHY THIS EXISTS. `/scan` already satisfied the safety rule — nothing is
 * created until the user confirms an editable form — but it kept no evidence:
 * the provider's output lived in memory, was used to pre-fill the form, and was
 * then discarded. The record it produced could say "ai_extracted" without
 * anyone being able to see what the model had actually read, or which values the
 * user corrected. Fleet intake records exactly that, and this closes the same
 * gap for the scan path.
 *
 * ONE ENGINE, NOT A FORK. This writes to `document_extractions` — the same table
 * Fleet intake and document-metadata extraction use — distinguished only by
 * `source = 'scan'`. It adds no second confirmation path and no second notion of
 * what a confirmed record is: the record was already created by the existing
 * create flows before this is called.
 *
 * ORDERING AND THE SAFETY RULE. The row is written AFTER the user confirmed and
 * after the record exists, so it is a record OF a confirmation, never a step
 * towards one. The `document_extractions_confirmed_has_record` constraint holds
 * either way: `created_record_id` is only ever set together with
 * `status='confirmed'` and `confirmed_at`.
 *
 * BEST EFFORT. Provenance must never cost a user the record they just confirmed,
 * so every failure here is swallowed and reported as `null`. The alternative —
 * failing the action after the maintenance log already exists — would be worse
 * for the user and would leave the two out of step anyway.
 */

/** Record tables an extraction can produce, as stored on the provenance row. */
export type ScanRecordType =
  | "maintenance"
  | "issue"
  | "insurance"
  | "registration"
  | "inspection";

/**
 * Which values the user changed between the model's reading and what was saved.
 *
 * Only the keys present in `extracted` are compared — a field the model never
 * proposed cannot have been "corrected", it was simply entered. Values are the
 * before/after pair, which is the point: the audit question is "what did the
 * model get wrong", and that is unanswerable from the final record alone.
 */
function buildFieldProvenance(
  extraction: ScanExtraction,
  values: ScanConfirmFormValues,
): Record<string, { extracted: unknown; confirmed: unknown }> {
  // Extraction field names differ from form field names in three places, the
  // same three the Fleet review screen maps.
  const pairs: [string, unknown][] = [
    ["date", values.date],
    ["mileage", values.mileage],
    ["service_details", values.description],
    ["service_type", values.service_type],
    ["garage_name", values.garage_name],
    ["cost", values.cost],
    ["insurer_name", values.insurer_name],
    ["insurance_type", values.insurance_type],
    ["start_date", values.start_date],
    ["end_date", values.end_date],
    ["notes", values.notes],
    ["next_service_date", values.date],
  ];

  const source = extraction as unknown as Record<string, unknown>;
  const out: Record<string, { extracted: unknown; confirmed: unknown }> = {};

  for (const [key, confirmed] of pairs) {
    if (!(key in source)) continue;
    const extracted = source[key];
    if (extracted == null || extracted === "") continue;
    const same = String(extracted) === String(confirmed ?? "");
    if (!same) out[key] = { extracted, confirmed: confirmed ?? null };
  }
  return out;
}

/**
 * Persist what the model read, what the user confirmed, and which record the
 * confirmation produced. Returns the extraction id, or null if it could not be
 * written (never throws).
 */
export async function recordScanProvenance(params: {
  vehicleId: string;
  category: ScanFormCategory;
  extraction: ScanExtraction | null;
  values: ScanConfirmFormValues;
  engine: string;
  recordType: ScanRecordType;
  recordId: string;
  documentId: string | null;
}): Promise<string | null> {
  // Nothing was extracted (manual fallback after a provider failure) and no
  // document was kept: there is no provenance to record, only a user's typing.
  if (!params.extraction && !params.documentId) return null;

  try {
    const supabase = await createClient();
    const { userId, organizationId } = await requireFleetWriter();

    // `document_extractions_has_file` requires a document_id or a pending file.
    // A scan whose image could not be persisted has neither, so it gets no
    // provenance row rather than a row that violates the schema's invariant.
    if (!params.documentId) return null;

    const { data, error } = await supabase
      .from("document_extractions")
      .insert({
        owner_user_id: userId,
        organization_id: organizationId,
        document_id: params.documentId,
        vehicle_id: params.vehicleId,
        source: "scan",
        engine: params.engine,
        // Confirmed in the same request, by the user, on an editable form.
        status: "confirmed",
        confirmed_at: new Date().toISOString(),
        confirmed_by: userId,
        // The model's raw reading, never overwritten.
        extracted_data: params.extraction ?? {},
        // What was actually saved, and the per-field diff between the two.
        confirmed_data: params.values,
        field_provenance: params.extraction
          ? buildFieldProvenance(params.extraction, params.values)
          : {},
        proposed_category: params.extraction?.document_category ?? null,
        confirmed_category: params.category,
        category_confidence: params.extraction?.confidence ?? null,
        // The vehicle was chosen by the user on the scan screen.
        vehicle_match_method: "user_selected",
        created_record_type: params.recordType,
        created_record_id: params.recordId,
      })
      .select("id")
      .single();

    if (error) {
      // Log the failure category only — never the extraction, which echoes
      // document contents.
      console.error("[scan] provenance row not written", {
        vehicleId: params.vehicleId,
        recordType: params.recordType,
        reason: error.code ?? "unknown",
      });
      return null;
    }
    return data.id as string;
  } catch {
    return null;
  }
}

import * as z from "zod";

/**
 * Fleet AI document intake — types.
 *
 * The intake record is a row of `document_extractions`; these types mirror the
 * columns added by 20260726120000_fleet_document_intake.sql. Nothing here is a
 * security boundary: the database decides who may read or confirm an intake,
 * and `confirm_fleet_intake()` re-validates every field this file describes.
 */

// -----------------------------------------------------------------------------
// State model
// -----------------------------------------------------------------------------
/**
 * Deliberately mapped onto the EXISTING `document_extractions.status` values
 * rather than inventing a parallel vocabulary:
 *
 *   pending_confirmation  extracted, awaiting human review  (the review state)
 *   confirmed             a record was created — terminal
 *   failed                extraction failed; retry allowed
 *   cancelled             the user abandoned the review — terminal
 *   superseded            a newer extraction replaced this one — terminal
 *   discarded             legacy value from the pre-Fleet metadata flow
 *
 * There is no separate "uploaded"/"queued"/"processing" row: extraction is a
 * single synchronous server action, so a row only exists once there is a result
 * to review. Adding empty rows for states no user can observe would be state for
 * its own sake.
 */
export const INTAKE_STATUSES = [
  "pending_confirmation",
  "confirmed",
  "failed",
  "cancelled",
  "superseded",
  "discarded",
] as const;
export type IntakeStatus = (typeof INTAKE_STATUSES)[number];

/** Categories that can become an operational record. */
export const INTAKE_CATEGORIES = [
  "maintenance",
  "insurance",
  "registration",
  "inspection",
] as const;
export type IntakeCategory = (typeof INTAKE_CATEGORIES)[number];

export function isIntakeCategory(value: unknown): value is IntakeCategory {
  return (
    typeof value === "string" &&
    (INTAKE_CATEGORIES as readonly string[]).includes(value)
  );
}

// -----------------------------------------------------------------------------
// Vehicle matching
// -----------------------------------------------------------------------------
/**
 * How the vehicle was resolved. Ordered strongest-first; `ambiguous`, `none`
 * and `conflict` all mean "the user must choose".
 */
export const MATCH_METHODS = [
  "vin",
  "registration",
  "registration_normalized",
  "user_selected",
  "ambiguous",
  "none",
  "conflict",
] as const;
export type MatchMethod = (typeof MATCH_METHODS)[number];

/** Methods that resolve to exactly one vehicle without asking the user. */
const AUTO_RESOLVED: readonly MatchMethod[] = [
  "vin",
  "registration",
  "registration_normalized",
];

/**
 * Whether the UI must force a manual selection.
 *
 * This is the deterministic threshold the whole matching story rests on: a
 * document is auto-attached ONLY when a strong identifier produced exactly one
 * candidate. Anything else — no identifier, several candidates, or extracted
 * identifiers that disagree with a preselected vehicle — is a question for the
 * user, never a guess.
 */
export function requiresManualVehicleSelection(
  method: MatchMethod | null,
  candidateCount: number,
): boolean {
  if (method == null) return true;
  if (method === "user_selected") return false;
  if (!AUTO_RESOLVED.includes(method)) return true;
  return candidateCount !== 1;
}

export interface VehicleCandidate {
  vehicle_id: string;
  method: MatchMethod;
  label: string;
  license_plate: string | null;
}

export interface VehicleMatchResult {
  method: MatchMethod;
  candidates: VehicleCandidate[];
  /** Set only when exactly one candidate was resolved by a strong identifier. */
  resolvedVehicleId: string | null;
  /** True when extracted identifiers disagree with a preselected vehicle. */
  conflictsWithPreselected: boolean;
}

// -----------------------------------------------------------------------------
// Confidence
// -----------------------------------------------------------------------------
/**
 * Classification thresholds. The provider returns a single 0..1 confidence for
 * the CLASSIFICATION only — it does not report per-field confidence, so this
 * codebase does not pretend to have it. Presenting a fabricated per-field score
 * would be worse than none.
 *
 *   >= ACCEPT   the proposed category is pre-selected (still fully editable)
 *   >= WARN     pre-selected, with a visible "please check" warning
 *   <  WARN     no category pre-selected; the user must choose
 */
export const CATEGORY_CONFIDENCE_ACCEPT = 0.8;
export const CATEGORY_CONFIDENCE_WARN = 0.5;

export type CategoryConfidenceLevel = "accepted" | "review" | "manual";

export function categoryConfidenceLevel(
  confidence: number | null,
  category: string | null,
): CategoryConfidenceLevel {
  if (category == null || category === "unknown") return "manual";
  if (confidence == null) return "review";
  if (confidence >= CATEGORY_CONFIDENCE_ACCEPT) return "accepted";
  if (confidence >= CATEGORY_CONFIDENCE_WARN) return "review";
  return "manual";
}

// -----------------------------------------------------------------------------
// Rows
// -----------------------------------------------------------------------------
export interface IntakeRecord {
  id: string;
  /** Null while a dashboard upload is still awaiting its vehicle. */
  document_id: string | null;
  vehicle_id: string | null;
  status: IntakeStatus;
  engine: string;
  provider_model: string | null;
  proposed_category: string | null;
  category_confidence: number | null;
  confirmed_category: string | null;
  vehicle_match_method: MatchMethod | null;
  vehicle_candidates: VehicleCandidate[];
  extracted_data: Record<string, unknown>;
  confirmed_data: Record<string, unknown> | null;
  field_provenance: Record<string, FieldProvenance>;
  created_record_type: IntakeCategory | null;
  created_record_id: string | null;
  confirmed_by: string | null;
  confirmed_at: string | null;
  created_at: string;
  content_hash: string | null;
}

/** What the model proposed for one field versus what the user confirmed. */
export interface FieldProvenance {
  extracted: string | number | null;
  confirmed: string | number | null;
  edited: boolean;
}

/** A prior upload of the identical file, surfaced as a warning. */
export interface DuplicateDocument {
  document_id: string;
  vehicle_id: string | null;
  title: string | null;
  document_date: string | null;
  created_at: string;
}

// -----------------------------------------------------------------------------
// Confirmation payload
// -----------------------------------------------------------------------------
/**
 * The editable review form. Every field is optional text: the form is a
 * correction surface, and over-validating it here would block a user from
 * fixing a value the model got wrong. Type and range enforcement happens in
 * `confirm_fleet_intake()`, which is the authority.
 */
export const intakeConfirmSchema = z.object({
  extractionId: z.uuid({ error: "invalid" }),
  vehicleId: z.uuid({ error: "vehicleRequired" }),
  category: z.enum(INTAKE_CATEGORIES, { error: "categoryRequired" }),
  performed_at: z.string().trim().optional(),
  start_date: z.string().trim().optional(),
  end_date: z.string().trim().optional(),
  next_service_date: z.string().trim().optional(),
  next_service_km: z.string().trim().optional(),
  mileage: z.string().trim().optional(),
  cost: z.string().trim().optional(),
  currency: z.string().trim().max(8).optional(),
  vendor_name: z.string().trim().max(120).optional(),
  insurer_name: z.string().trim().max(120).optional(),
  insurance_type: z.string().trim().max(120).optional(),
  service_type: z.string().trim().max(120).optional(),
  description: z.string().trim().max(2000).optional(),
  notes: z.string().trim().max(2000).optional(),
});

export type IntakeConfirmInput = z.infer<typeof intakeConfirmSchema>;

/** Translation keys under `fleet.intake.errors`. */
export type IntakeErrorKey =
  | "notAuthenticated"
  | "notAuthorized"
  | "extractionNotFound"
  | "vehicleNotFound"
  | "vehicleRequired"
  | "categoryRequired"
  | "invalidCategory"
  | "invalidPayload"
  | "stale"
  | "fileRequired"
  | "invalidFileType"
  | "fileTooLarge"
  | "extractFailed"
  | "uploadFailed"
  | "saveFailed";

export type IntakeConfirmResult =
  | {
      ok: true;
      recordType: IntakeCategory;
      recordId: string;
      vehicleId: string;
      /** True when the extraction was already confirmed — a repeat request. */
      alreadyConfirmed: boolean;
    }
  | { ok: false; error: IntakeErrorKey };

/** Map an RPC `state` onto a translation key. */
export function intakeStateToError(state: string | undefined): IntakeErrorKey {
  switch (state) {
    case "not_authenticated":
      return "notAuthenticated";
    case "not_authorized":
      return "notAuthorized";
    case "extraction_not_found":
      return "extractionNotFound";
    case "vehicle_not_found":
      return "vehicleNotFound";
    case "invalid_category":
      return "invalidCategory";
    case "invalid_payload":
      return "invalidPayload";
    case "stale":
      return "stale";
    default:
      return "saveFailed";
  }
}

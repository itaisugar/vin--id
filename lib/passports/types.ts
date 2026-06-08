import * as z from "zod";

// -----------------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------------
export const PASSPORT_STATUSES = [
  "draft",
  "active",
  "revoked",
  "expired",
  "accepted",
] as const;
export type PassportStatus = (typeof PASSPORT_STATUSES)[number];

export const PASSPORT_SCOPES = [
  "maintenance",
  "issues",
  "documents",
  "reminders",
] as const;
export type PassportScope = (typeof PASSPORT_SCOPES)[number];

/** Transfer token / share-link lifetime. */
export const TOKEN_TTL_HOURS = 72;

/** Recency thresholds for "recent service" (Record Confidence). */
export const RECENT_SERVICE_DAYS = 365;
export const RECENT_SERVICE_MILEAGE = 15_000;

export const RECORD_CONFIDENCE_HELP_KEY = "passports.confidenceHelp";

// -----------------------------------------------------------------------------
// Create options (Zod) — booleans chosen by the owner.
// -----------------------------------------------------------------------------
export const passportOptionsSchema = z.object({
  includeMaintenance: z.boolean().default(true),
  includeIssues: z.boolean().default(true),
  includeDocuments: z.boolean().default(true),
  includeReminders: z.boolean().default(true),
  /** Personal-info documents are excluded unless the owner opts in. */
  includePersonalDocs: z.boolean().default(false),
});
export type PassportOptions = z.infer<typeof passportOptionsSchema>;

// -----------------------------------------------------------------------------
// Snapshot structure (stored in vehicle_passports.snapshot, and hashed).
// Storage paths and signed URLs are intentionally excluded.
// -----------------------------------------------------------------------------
export interface SnapshotMeta {
  passport_id: string;
  version: number;
  created_at: string;
  expires_at: string | null;
  issuer_user_id: string;
}

export interface SnapshotVehicle {
  vehicle_id: string;
  make: string | null;
  model: string | null;
  year: number | null;
  vin: string | null;
  license_plate: string | null;
  current_mileage: number | null;
  mileage_unit: string;
  status: string;
}

export interface SnapshotMaintenance {
  id: string;
  date: string | null;
  mileage: number | null;
  category: string | null;
  description: string | null;
  cost: number | null;
  currency: string | null;
  trust_level: string;
  source_type: string;
}

export interface SnapshotIssue {
  id: string;
  date: string | null;
  mileage: number | null;
  symptoms: string | null;
  status: string;
  severity: string;
  resolution_notes: string | null;
  trust_level: string;
  source_type: string;
}

export interface SnapshotDocument {
  id: string;
  file_name: string | null;
  mime_type: string | null;
  document_type: string;
  document_date: string | null;
  expiry_date: string | null;
  vendor: string | null;
  amount: number | null;
  currency: string | null;
  contains_personal_info: boolean;
  share_allowed: boolean;
  trust_level: string;
  source_type: string;
}

export interface SnapshotReminder {
  id: string;
  title: string | null;
  description: string | null;
  reminder_type: string;
  due_date: string | null;
  due_mileage: number | null;
  urgency: string;
  status: string;
}

export interface SnapshotMissing {
  issue_history_excluded: boolean;
  documents_excluded_count: number;
  personal_documents_excluded_count: number;
  no_document_backed_records: boolean;
  no_recent_service: boolean;
}

export interface PassportSnapshot {
  meta: SnapshotMeta;
  vehicle: SnapshotVehicle;
  included_scopes: PassportScope[];
  maintenance: SnapshotMaintenance[];
  issues: SnapshotIssue[];
  documents: SnapshotDocument[];
  reminders: SnapshotReminder[];
  missing_or_not_shared: SnapshotMissing;
  disclaimer: {
    not_official_ownership_document: true;
    not_mechanical_certification: true;
    record_confidence_not_condition_score: true;
  };
}

// -----------------------------------------------------------------------------
// Deterministic summary (stored in ai_summary). Items are stable CODES that the
// UI maps to translated, cautious text.
// -----------------------------------------------------------------------------
export interface PassportSummary {
  strengths: string[];
  attention_points: string[];
  recommended_checks: string[];
  missing_or_not_shared: string[];
  generated: "deterministic";
}

// -----------------------------------------------------------------------------
// Row shape
// -----------------------------------------------------------------------------
export interface VehiclePassport {
  id: string;
  owner_user_id: string;
  vehicle_id: string;
  public_id: string;
  status: PassportStatus;
  version: number;
  snapshot: PassportSnapshot;
  snapshot_hash: string | null;
  record_confidence_score: number | null;
  ai_summary: PassportSummary | Record<string, never>;
  server_signature: string | null;
  issued_at: string | null;
  expires_at: string | null;
  revoked_at: string | null;
  accepted_at: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export const PASSPORT_COLUMNS =
  "id, owner_user_id, vehicle_id, public_id, status, version, snapshot, snapshot_hash, record_confidence_score, ai_summary, server_signature, issued_at, expires_at, revoked_at, accepted_at, created_at, updated_at, deleted_at";

/** Effective status for display: an active-but-past-expiry passport is expired. */
export function effectiveStatus(p: {
  status: PassportStatus;
  expires_at: string | null;
}): PassportStatus {
  if (p.status === "active" && p.expires_at && Date.parse(p.expires_at) < Date.now()) {
    return "expired";
  }
  return p.status;
}

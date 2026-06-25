import * as z from "zod";

// -----------------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------------
export const ISSUE_SEVERITIES = [
  "info",
  "monitor",
  "diy_simple",
  "mechanic_recommended",
  "urgent",
  "stop_immediately",
] as const;
export type IssueSeverity = (typeof ISSUE_SEVERITIES)[number];

export const ISSUE_STATUSES = ["open", "monitoring", "resolved"] as const;
export type IssueStatus = (typeof ISSUE_STATUSES)[number];

/** Product trust vocabulary (stored in the DB column `trust_label`). */
export const TRUST_LEVELS = [
  "user_entered",
  "document_backed",
  "ai_extracted",
  "mechanic_verified",
  "external_source",
] as const;
export type TrustLevel = (typeof TRUST_LEVELS)[number];

/** Values a user may choose today. The rest are reserved for later phases. */
export const SELECTABLE_TRUST_LEVELS: TrustLevel[] = [
  "user_entered",
  "document_backed",
];

// -----------------------------------------------------------------------------
// Row shape. DB column names kept as-is: reported_at = the date,
// title = the symptoms text. `description` is unused by this feature.
// -----------------------------------------------------------------------------
export interface IssueLog {
  id: string;
  owner_user_id: string;
  vehicle_id: string;
  reported_at: string | null;
  mileage: number | null;
  title: string | null;
  description: string | null;
  severity: IssueSeverity;
  status: IssueStatus;
  resolution_notes: string | null;
  resolved_at: string | null;
  trust_label: TrustLevel;
  source_type: string;
  /** Optional link to the saved scan/source document (vehicle_documents.id). */
  document_id: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export const ISSUE_COLUMNS =
  "id, owner_user_id, vehicle_id, reported_at, mileage, title, description, severity, status, resolution_notes, resolved_at, trust_label, source_type, document_id, created_at, updated_at, deleted_at";

// -----------------------------------------------------------------------------
// Validation — error messages are translation keys (under `issues.form.errors`).
// -----------------------------------------------------------------------------
const emptyToUndefined = (v: unknown) =>
  typeof v === "string" && v.trim() === "" ? undefined : v;

export const issueInputSchema = z.object({
  date: z
    .string({ error: "required" })
    .trim()
    .min(1, { error: "required" })
    .refine((v) => !Number.isNaN(Date.parse(v)), { error: "invalidDate" }),
  mileage: z.preprocess(
    emptyToUndefined,
    z.coerce
      .number({ error: "invalidMileage" })
      .int({ error: "invalidMileage" })
      .min(0, { error: "invalidMileage" })
      .max(10_000_000, { error: "invalidMileage" })
      .optional(),
  ),
  symptoms: z
    .string({ error: "required" })
    .trim()
    .min(1, { error: "required" })
    .max(2000, { error: "tooLong" }),
  status: z.enum(ISSUE_STATUSES).default("open"),
  severity: z.enum(ISSUE_SEVERITIES).default("monitor"),
  resolution_notes: z.preprocess(
    emptyToUndefined,
    z.string().trim().max(2000, { error: "tooLong" }).optional(),
  ),
  // Accept any known trust value (so editing legacy/AI rows works); the UI only
  // offers the selectable subset.
  trust_label: z.enum(TRUST_LEVELS).default("user_entered"),
});

/** Parsed/normalized issue input (server-side, ready to persist). */
export type IssueInput = z.infer<typeof issueInputSchema>;

/** Raw form field shape used by React Hook Form (text inputs are strings). */
export interface IssueFormValues {
  date: string;
  mileage: string;
  symptoms: string;
  status: IssueStatus;
  severity: IssueSeverity;
  resolution_notes: string;
  trust_label: TrustLevel;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function emptyIssueForm(): IssueFormValues {
  return {
    date: todayIso(),
    mileage: "",
    symptoms: "",
    status: "open",
    severity: "monitor",
    resolution_notes: "",
    trust_label: "user_entered",
  };
}

/** Map a stored issue into RHF default values (for the edit form). */
export function issueToFormValues(i: IssueLog): IssueFormValues {
  return {
    date: i.reported_at ?? "",
    mileage: i.mileage != null ? String(i.mileage) : "",
    symptoms: i.title ?? "",
    status: i.status,
    severity: i.severity,
    resolution_notes: i.resolution_notes ?? "",
    trust_label: i.trust_label,
  };
}

/**
 * Convert validated input into a Supabase row payload (maps to DB columns).
 * Note: `resolved_at` is managed by the service based on status, not here.
 */
export function issueInputToRow(input: IssueInput) {
  return {
    reported_at: input.date,
    mileage: input.mileage ?? null,
    title: input.symptoms,
    severity: input.severity,
    status: input.status,
    resolution_notes: input.resolution_notes ?? null,
    trust_label: input.trust_label,
  };
}

import * as z from "zod";

import type { DeadlineState } from "./dates";

// -----------------------------------------------------------------------------
// Operational status
// -----------------------------------------------------------------------------
/**
 * "Can this vehicle work today?"
 *
 * This is a SEPARATE axis from `vehicles.status` (active | archived | sold),
 * which is the lifecycle column that drives archiving and the Passport
 * ownership-transfer flow. Both columns exist; neither replaces the other.
 */
export const OPERATIONAL_STATUSES = [
  "active",
  "needs_service",
  "issue_open",
  "out_of_service",
  "in_garage",
  "documents_missing",
] as const;
export type OperationalStatus = (typeof OPERATIONAL_STATUSES)[number];

export const DEFAULT_OPERATIONAL_STATUS: OperationalStatus = "active";

export function isOperationalStatus(v: unknown): v is OperationalStatus {
  return (
    typeof v === "string" &&
    (OPERATIONAL_STATUSES as readonly string[]).includes(v)
  );
}

/**
 * Every non-active operational status counts as "needs attention" — this is the
 * definition the dashboard and the vehicles-list filter both use, so the two
 * can never disagree.
 */
export const ATTENTION_STATUSES: readonly OperationalStatus[] =
  OPERATIONAL_STATUSES.filter((s) => s !== "active");

export function needsAttention(status: OperationalStatus): boolean {
  return status !== "active";
}

// -----------------------------------------------------------------------------
// Effective operational status
// -----------------------------------------------------------------------------
/**
 * Statuses a human declares, which are never recomputed away.
 *
 * `documents_missing` is here for the reason given on {@link DocumentStatus}:
 * "missing" is not derivable from any table, so the explicit flag is the only
 * honest signal there is. Clearing it automatically would delete information.
 */
export const DECLARED_OPERATIONAL_STATUSES: readonly OperationalStatus[] = [
  "out_of_service",
  "in_garage",
  "documents_missing",
];

export function isDeclaredOperationalStatus(
  status: OperationalStatus,
): boolean {
  return (DECLARED_OPERATIONAL_STATUSES as readonly string[]).includes(status);
}

/** Live facts that decide a derived status. */
export interface OperationalSignals {
  /** Issues in an OPEN_ISSUE_STATUSES state right now. */
  openIssueCount: number;
  /** Worst of the date- and mileage-based service signals. */
  serviceState: DeadlineState | null;
}

/**
 * THE authoritative operational status for display, filtering and counting.
 *
 * A declared status always wins. Otherwise the status is recomputed from live
 * rows every time it is read, so it cannot go stale:
 *
 *   * at least one open issue      -> issue_open
 *   * service overdue or due soon  -> needs_service
 *   * neither                      -> active
 *
 * The stored column keeps its value in the database — this never writes, and a
 * vehicle that a user manually set to `issue_open` simply resolves to `active`
 * once no open issue remains, which is the whole point.
 *
 * Precedence between the two derived states follows STATUS_RANK in ./types:
 * `issue_open` (1) is more urgent than `needs_service` (2).
 */
export function effectiveOperationalStatus(
  stored: OperationalStatus,
  signals: OperationalSignals,
): OperationalStatus {
  if (isDeclaredOperationalStatus(stored)) return stored;
  if (signals.openIssueCount > 0) return "issue_open";
  if (signals.serviceState === "overdue" || signals.serviceState === "due_soon") {
    return "needs_service";
  }
  return "active";
}

/**
 * Badge tone per status. Colour is decorative only — every status is ALWAYS
 * rendered with its translated text label alongside, never colour alone.
 */
export const OPERATIONAL_STATUS_TONE: Record<
  OperationalStatus,
  "success" | "warning" | "danger" | "muted" | "neutral"
> = {
  active: "success",
  needs_service: "warning",
  issue_open: "warning",
  out_of_service: "danger",
  in_garage: "neutral",
  documents_missing: "warning",
};

/** Severity ordering used to sort "requires attention" — worst first. */
const STATUS_RANK: Record<OperationalStatus, number> = {
  out_of_service: 0,
  issue_open: 1,
  needs_service: 2,
  documents_missing: 3,
  in_garage: 4,
  active: 5,
};

export function compareOperationalStatus(
  a: OperationalStatus,
  b: OperationalStatus,
): number {
  return STATUS_RANK[a] - STATUS_RANK[b];
}

// -----------------------------------------------------------------------------
// Vehicle type (free-form, with common suggestions)
// -----------------------------------------------------------------------------
/**
 * Suggestions only — `vehicle_type` is nullable free text in the DB so a
 * business can describe its own mix without a schema change.
 */
export const VEHICLE_TYPE_SUGGESTIONS = [
  "car",
  "van",
  "pickup",
  "truck",
  "motorcycle",
  "bus",
  "other",
] as const;

// -----------------------------------------------------------------------------
// Filters & sorting for the fleet vehicles list
// -----------------------------------------------------------------------------
/**
 * Practical filters only — not a query builder.
 *
 * The first group answers operational questions ("what is overdue?"); the
 * operational statuses are kept as filters too so the dashboard status tiles can
 * link straight into a filtered list.
 */
export const FLEET_FILTERS = [
  "all",
  "needs_attention",
  "service_overdue",
  "service_due_soon",
  "document_expiring",
  "open_issues",
  "driver_assigned",
  "driver_unassigned",
  ...OPERATIONAL_STATUSES,
] as const;
export type FleetFilter = (typeof FLEET_FILTERS)[number];

export function isFleetFilter(v: unknown): v is FleetFilter {
  return typeof v === "string" && (FLEET_FILTERS as readonly string[]).includes(v);
}

/** Filters offered as chips, in display order. */
export const PRIMARY_FLEET_FILTERS: readonly FleetFilter[] = [
  "all",
  "needs_attention",
  "service_overdue",
  "service_due_soon",
  "document_expiring",
  "open_issues",
  "driver_unassigned",
];

export const FLEET_SORTS = [
  "urgency",
  "name",
  "license_plate",
  "next_service",
  "document_expiry",
  "cost",
  "status",
  "recently_updated",
] as const;
export type FleetSort = (typeof FLEET_SORTS)[number];

/** Urgency first: the list opens on whatever needs handling today. */
export const DEFAULT_FLEET_SORT: FleetSort = "urgency";

export function isFleetSort(v: unknown): v is FleetSort {
  return typeof v === "string" && (FLEET_SORTS as readonly string[]).includes(v);
}

// -----------------------------------------------------------------------------
// Validation
// -----------------------------------------------------------------------------
// Error values are translation keys, resolved under `vehicles.form.errors`
// (matching the existing vehicle form convention).

const emptyToUndefined = (v: unknown) =>
  typeof v === "string" && v.trim() === "" ? undefined : v;

const optionalText = (max: number) =>
  z.preprocess(
    emptyToUndefined,
    z.string().trim().max(max, { error: "tooLong" }).optional(),
  );

/** ISO date (yyyy-mm-dd) that must also be a real calendar date. */
const optionalDate = z.preprocess(
  emptyToUndefined,
  z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, { error: "invalidDate" })
    .refine((s) => !Number.isNaN(Date.parse(s)), { error: "invalidDate" })
    .optional(),
);

const optionalKm = z.preprocess(
  emptyToUndefined,
  z.coerce
    .number({ error: "invalidMileage" })
    .int({ error: "invalidMileage" })
    .min(0, { error: "invalidMileage" })
    .max(10_000_000, { error: "invalidMileage" })
    .optional(),
);

/**
 * Phone is stored as entered (no normalization) — Israeli fleets mix local and
 * international formats and rewriting them loses information. Validation only
 * rejects obviously-wrong input.
 */
const optionalPhone = z.preprocess(
  emptyToUndefined,
  z
    .string()
    .trim()
    .max(40, { error: "tooLong" })
    .regex(/^[+0-9()\-.\s]{6,40}$/, { error: "invalidPhone" })
    .optional(),
);

/** Fleet fields appended to the existing vehicle form. */
export const fleetVehicleFieldsSchema = z.object({
  operational_status: z
    .enum(OPERATIONAL_STATUSES)
    .default(DEFAULT_OPERATIONAL_STATUS),
  vehicle_type: optionalText(40),
  assigned_driver_name: optionalText(120),
  assigned_driver_phone: optionalPhone,
  next_service_date: optionalDate,
  next_service_km: optionalKm,
  test_expiry_date: optionalDate,
  insurance_expiry_date: optionalDate,
});

export type FleetVehicleFields = z.infer<typeof fleetVehicleFieldsSchema>;

/** Raw RHF field shape (all inputs are strings). */
export interface FleetVehicleFormValues {
  operational_status: OperationalStatus;
  vehicle_type: string;
  assigned_driver_name: string;
  assigned_driver_phone: string;
  next_service_date: string;
  next_service_km: string;
  test_expiry_date: string;
  insurance_expiry_date: string;
}

export const EMPTY_FLEET_FORM: FleetVehicleFormValues = {
  operational_status: DEFAULT_OPERATIONAL_STATUS,
  vehicle_type: "",
  assigned_driver_name: "",
  assigned_driver_phone: "",
  next_service_date: "",
  next_service_km: "",
  test_expiry_date: "",
  insurance_expiry_date: "",
};

/**
 * Map validated fleet fields onto a Supabase row payload. Empty optional values
 * become `null` (never `""`) so the column stays consistently nullable.
 *
 * `assigned_driver_name` / `assigned_driver_phone` are DELIBERATELY ABSENT.
 * They were free text that looked like a driver assignment while granting no
 * access whatsoever — the authoritative assignment is a `driver_assignments`
 * row, created through `assign_driver()`. The inputs are gone from the form, so
 * including the columns here would write NULL over whatever a fleet manager
 * typed before this change. Omitting them from the payload leaves every
 * historical value exactly where it is (it is still read and displayed by
 * <LegacyDriverNote>) while making it impossible to set a new one.
 *
 * The schema still accepts both keys so any older caller keeps validating; they
 * simply no longer reach the database.
 */
export function fleetFieldsToRow(input: FleetVehicleFields) {
  return {
    operational_status: input.operational_status,
    vehicle_type: input.vehicle_type ?? null,
    next_service_date: input.next_service_date ?? null,
    next_service_km: input.next_service_km ?? null,
    test_expiry_date: input.test_expiry_date ?? null,
    insurance_expiry_date: input.insurance_expiry_date ?? null,
  };
}

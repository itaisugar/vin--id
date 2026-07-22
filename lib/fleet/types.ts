import * as z from "zod";

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
export const FLEET_FILTERS = [
  "all",
  "needs_attention",
  ...OPERATIONAL_STATUSES,
] as const;
export type FleetFilter = (typeof FLEET_FILTERS)[number];

export function isFleetFilter(v: unknown): v is FleetFilter {
  return typeof v === "string" && (FLEET_FILTERS as readonly string[]).includes(v);
}

export const FLEET_SORTS = [
  "status",
  "license_plate",
  "next_service",
  "document_expiry",
  "recently_updated",
] as const;
export type FleetSort = (typeof FLEET_SORTS)[number];

export const DEFAULT_FLEET_SORT: FleetSort = "status";

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
 */
export function fleetFieldsToRow(input: FleetVehicleFields) {
  return {
    operational_status: input.operational_status,
    vehicle_type: input.vehicle_type ?? null,
    assigned_driver_name: input.assigned_driver_name ?? null,
    assigned_driver_phone: input.assigned_driver_phone ?? null,
    next_service_date: input.next_service_date ?? null,
    next_service_km: input.next_service_km ?? null,
    test_expiry_date: input.test_expiry_date ?? null,
    insurance_expiry_date: input.insurance_expiry_date ?? null,
  };
}

import * as z from "zod";
import {
  EMPTY_FLEET_FORM,
  fleetFieldsToRow,
  fleetVehicleFieldsSchema,
  type FleetVehicleFormValues,
  type OperationalStatus,
} from "@/lib/fleet/types";

// -----------------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------------
/** LIFECYCLE status. See also `OperationalStatus` in `lib/fleet/types`. */
export const VEHICLE_STATUSES = ["active", "archived", "sold"] as const;
export type VehicleStatus = (typeof VEHICLE_STATUSES)[number];

export const MILEAGE_UNITS = ["km", "miles"] as const;
export type MileageUnit = (typeof MILEAGE_UNITS)[number];

const KM_PER_MILE = 1.609344;

/**
 * Convert a mileage value between km and miles, rounded to a whole number.
 * Mileage is stored per-vehicle in a single canonical unit (`mileage_unit`), so
 * a reading entered in the other unit must be converted before it is persisted.
 */
export function convertMileage(
  value: number,
  from: MileageUnit,
  to: MileageUnit,
): number {
  if (from === to) return value;
  return from === "miles"
    ? Math.round(value * KM_PER_MILE)
    : Math.round(value / KM_PER_MILE);
}

const CURRENT_YEAR = new Date().getFullYear();
const MAX_YEAR = CURRENT_YEAR + 1; // allow next model year

// -----------------------------------------------------------------------------
// Row shape (what we read back from Supabase)
// -----------------------------------------------------------------------------
export interface Vehicle {
  id: string;
  owner_user_id: string;
  /** Owning organization (Fleet Lite). Server-derived; never client-supplied. */
  organization_id: string;
  make: string | null;
  model: string | null;
  year: number | null;
  vin: string | null;
  license_plate: string | null;
  /**
   * The fleet's "Current KM". There is deliberately no separate `current_km`
   * column — this is the single source of truth, and `mileage_unit` records
   * whether it is km or miles.
   */
  current_mileage: number | null;
  mileage_unit: MileageUnit;
  photo_url: string | null;
  /** LIFECYCLE status — drives archive/sold and the Passport transfer flow. */
  status: VehicleStatus;
  /** OPERATIONAL status — "can this vehicle work today?". A separate axis. */
  operational_status: OperationalStatus;
  vehicle_type: string | null;
  assigned_driver_name: string | null;
  assigned_driver_phone: string | null;
  next_service_date: string | null;
  next_service_km: number | null;
  test_expiry_date: string | null;
  insurance_expiry_date: string | null;
  archived_at: string | null;
  sold_at: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

// Columns selected for list/detail views.
export const VEHICLE_COLUMNS =
  "id, owner_user_id, organization_id, make, model, year, vin, license_plate, current_mileage, mileage_unit, photo_url, status, operational_status, vehicle_type, assigned_driver_name, assigned_driver_phone, next_service_date, next_service_km, test_expiry_date, insurance_expiry_date, archived_at, sold_at, created_at, updated_at, deleted_at";

// -----------------------------------------------------------------------------
// Validation
// -----------------------------------------------------------------------------
// Error messages are *translation keys* (resolved under `vehicles.form.errors`
// in the UI). The schema accepts raw form strings and coerces/normalizes them,
// so it is the single source of truth on both client (RHF) and server.

const emptyToUndefined = (v: unknown) =>
  typeof v === "string" && v.trim() === "" ? undefined : v;

const optionalText = (max: number) =>
  z.preprocess(
    emptyToUndefined,
    z.string().trim().max(max, { error: "tooLong" }).optional(),
  );

/** Original consumer vehicle fields. Extended with fleet fields below. */
const vehicleBaseSchema = z.object({
  make: z
    .string({ error: "required" })
    .trim()
    .min(1, { error: "required" })
    .max(60, { error: "tooLong" }),
  model: z
    .string({ error: "required" })
    .trim()
    .min(1, { error: "required" })
    .max(60, { error: "tooLong" }),
  year: z.coerce
    .number({ error: "invalidYear" })
    .int({ error: "invalidYear" })
    .min(1900, { error: "invalidYear" })
    .max(MAX_YEAR, { error: "invalidYear" }),
  vin: optionalText(64),
  license_plate: optionalText(32),
  mileage: z.preprocess(
    emptyToUndefined,
    z.coerce
      .number({ error: "invalidMileage" })
      .int({ error: "invalidMileage" })
      .min(0, { error: "invalidMileage" })
      .max(10_000_000, { error: "invalidMileage" })
      .optional(),
  ),
  mileage_unit: z.enum(MILEAGE_UNITS).default("km"),
  // `photo_url` is intentionally NOT a form input. The column still exists and
  // stored values are preserved and displayed (see `Vehicle.photo_url` /
  // `vehicle-card`), but the create/edit forms no longer own it — so it is never
  // parsed from, or written by, the form. Any stray client value is stripped by
  // this object schema.
});

/**
 * The full vehicle form = the original consumer fields + the Fleet Lite fields.
 *
 * NOTE on `next_service_km` vs current mileage: a next-service reading BELOW
 * the current odometer is deliberately ALLOWED. It means the service is
 * overdue, which is a first-class fleet state the dashboard reports on —
 * rejecting it would make an overdue service impossible to record. The UI
 * surfaces it as "Overdue" rather than as a validation error.
 */
export const vehicleInputSchema = vehicleBaseSchema.extend(
  fleetVehicleFieldsSchema.shape,
);

/** Parsed/normalized vehicle input (server-side, ready to persist). */
export type VehicleInput = z.infer<typeof vehicleInputSchema>;

/** Raw form field shape used by React Hook Form (all text inputs are strings). */
export interface VehicleFormValues extends FleetVehicleFormValues {
  make: string;
  model: string;
  year: string;
  vin: string;
  license_plate: string;
  mileage: string;
  mileage_unit: MileageUnit;
}

export const EMPTY_VEHICLE_FORM: VehicleFormValues = {
  make: "",
  model: "",
  year: "",
  vin: "",
  license_plate: "",
  mileage: "",
  mileage_unit: "km",
  ...EMPTY_FLEET_FORM,
};

/** Map a stored vehicle into RHF default values (for the edit form). */
export function vehicleToFormValues(v: Vehicle): VehicleFormValues {
  return {
    make: v.make ?? "",
    model: v.model ?? "",
    year: v.year != null ? String(v.year) : "",
    vin: v.vin ?? "",
    license_plate: v.license_plate ?? "",
    mileage: v.current_mileage != null ? String(v.current_mileage) : "",
    mileage_unit: v.mileage_unit ?? "km",
    // Fleet fields
    operational_status: v.operational_status ?? "active",
    vehicle_type: v.vehicle_type ?? "",
    assigned_driver_name: v.assigned_driver_name ?? "",
    assigned_driver_phone: v.assigned_driver_phone ?? "",
    next_service_date: v.next_service_date ?? "",
    next_service_km: v.next_service_km != null ? String(v.next_service_km) : "",
    test_expiry_date: v.test_expiry_date ?? "",
    insurance_expiry_date: v.insurance_expiry_date ?? "",
  };
}

/**
 * Convert validated input into a Supabase row payload.
 *
 * `organization_id` is deliberately ABSENT: it is derived server-side (by the
 * `*_set_organization_id` BEFORE INSERT trigger, from the row owner's profile)
 * and can never be set from form input.
 */
export function vehicleInputToRow(input: VehicleInput) {
  return {
    make: input.make,
    model: input.model,
    year: input.year,
    vin: input.vin ?? null,
    license_plate: input.license_plate ?? null,
    current_mileage: input.mileage ?? null,
    mileage_unit: input.mileage_unit,
    // `photo_url` is deliberately omitted from the payload. On CREATE the column
    // defaults to null; on UPDATE (a full-row `.update`) omitting it means an
    // existing stored value is PRESERVED rather than nulled out. The form no
    // longer owns this field — see the schema note above.
    ...fleetFieldsToRow(input),
  };
}

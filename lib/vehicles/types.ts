import * as z from "zod";

// -----------------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------------
export const VEHICLE_STATUSES = ["active", "archived", "sold"] as const;
export type VehicleStatus = (typeof VEHICLE_STATUSES)[number];

export const MILEAGE_UNITS = ["km", "miles"] as const;
export type MileageUnit = (typeof MILEAGE_UNITS)[number];

const CURRENT_YEAR = new Date().getFullYear();
const MAX_YEAR = CURRENT_YEAR + 1; // allow next model year

// -----------------------------------------------------------------------------
// Row shape (what we read back from Supabase)
// -----------------------------------------------------------------------------
export interface Vehicle {
  id: string;
  owner_user_id: string;
  make: string | null;
  model: string | null;
  year: number | null;
  vin: string | null;
  license_plate: string | null;
  current_mileage: number | null;
  mileage_unit: MileageUnit;
  photo_url: string | null;
  status: VehicleStatus;
  archived_at: string | null;
  sold_at: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

// Columns selected for list/detail views.
export const VEHICLE_COLUMNS =
  "id, owner_user_id, make, model, year, vin, license_plate, current_mileage, mileage_unit, photo_url, status, archived_at, sold_at, created_at, updated_at, deleted_at";

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

export const vehicleInputSchema = z.object({
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
  photo_url: z.preprocess(
    emptyToUndefined,
    z.url({ error: "invalidUrl" }).max(2048, { error: "tooLong" }).optional(),
  ),
});

/** Parsed/normalized vehicle input (server-side, ready to persist). */
export type VehicleInput = z.infer<typeof vehicleInputSchema>;

/** Raw form field shape used by React Hook Form (all text inputs are strings). */
export interface VehicleFormValues {
  make: string;
  model: string;
  year: string;
  vin: string;
  license_plate: string;
  mileage: string;
  mileage_unit: MileageUnit;
  photo_url: string;
}

export const EMPTY_VEHICLE_FORM: VehicleFormValues = {
  make: "",
  model: "",
  year: "",
  vin: "",
  license_plate: "",
  mileage: "",
  mileage_unit: "km",
  photo_url: "",
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
    photo_url: v.photo_url ?? "",
  };
}

/** Convert validated input into a Supabase row payload (maps mileage column). */
export function vehicleInputToRow(input: VehicleInput) {
  return {
    make: input.make,
    model: input.model,
    year: input.year,
    vin: input.vin ?? null,
    license_plate: input.license_plate ?? null,
    current_mileage: input.mileage ?? null,
    mileage_unit: input.mileage_unit,
    photo_url: input.photo_url ?? null,
  };
}

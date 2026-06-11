import * as z from "zod";
import { TRUST_LEVELS, type TrustLevel } from "@/lib/maintenance/types";

/**
 * Validation + row mapping for the owner-scoped insurance / registration /
 * inspection records created from the document-scan flow (and, later, manual
 * entry). Error messages are translation keys (resolved under `scan.errors`).
 * Conventions mirror maintenance: dates are ISO strings, numeric/int fields are
 * coerced, empty strings become null, and `trust_label` uses the shared 5-value
 * vocabulary. These map to the `vehicle_insurance` / `vehicle_registration` /
 * `vehicle_inspection` tables.
 */

const emptyToUndefined = (v: unknown) =>
  typeof v === "string" && v.trim() === "" ? undefined : v;

const optionalDate = z.preprocess(
  emptyToUndefined,
  z
    .string()
    .refine((v) => !Number.isNaN(Date.parse(v)), { error: "invalidDate" })
    .optional(),
);

const optionalMileage = z.preprocess(
  emptyToUndefined,
  z.coerce
    .number({ error: "invalidMileage" })
    .int({ error: "invalidMileage" })
    .min(0, { error: "invalidMileage" })
    .max(10_000_000, { error: "invalidMileage" })
    .optional(),
);

const optionalCost = z.preprocess(
  emptyToUndefined,
  z.coerce
    .number({ error: "invalidCost" })
    .min(0, { error: "invalidCost" })
    .max(100_000_000, { error: "invalidCost" })
    .optional(),
);

const optionalText = (max: number) =>
  z.preprocess(
    emptyToUndefined,
    z.string().trim().max(max, { error: "tooLong" }).optional(),
  );

// Accept any known trust value; the scan flow forces 'ai_extracted' server-side.
const trustLabel = z.enum(TRUST_LEVELS).default("user_entered");

// -----------------------------------------------------------------------------
// Insurance
// -----------------------------------------------------------------------------
export const insuranceInputSchema = z.object({
  insurer_name: optionalText(120),
  start_date: optionalDate,
  end_date: optionalDate,
  cost: optionalCost,
  insurance_type: optionalText(120),
  trust_label: trustLabel,
});
export type InsuranceInput = z.infer<typeof insuranceInputSchema>;

export function insuranceInputToRow(input: InsuranceInput) {
  return {
    insurer_name: input.insurer_name ?? null,
    start_date: input.start_date ?? null,
    end_date: input.end_date ?? null,
    cost: input.cost ?? null,
    insurance_type: input.insurance_type ?? null,
    trust_label: input.trust_label,
  };
}

// -----------------------------------------------------------------------------
// Registration (vehicle licensing)
// -----------------------------------------------------------------------------
export const registrationInputSchema = z.object({
  start_date: optionalDate,
  end_date: optionalDate,
  mileage: optionalMileage,
  notes: optionalText(2000),
  trust_label: trustLabel,
});
export type RegistrationInput = z.infer<typeof registrationInputSchema>;

export function registrationInputToRow(input: RegistrationInput) {
  return {
    start_date: input.start_date ?? null,
    end_date: input.end_date ?? null,
    mileage: input.mileage ?? null,
    notes: input.notes ?? null,
    trust_label: input.trust_label,
  };
}

// -----------------------------------------------------------------------------
// Inspection (vehicle test)
// -----------------------------------------------------------------------------
export const inspectionInputSchema = z.object({
  start_date: optionalDate,
  end_date: optionalDate,
  mileage: optionalMileage,
  cost: optionalCost,
  notes: optionalText(2000),
  trust_label: trustLabel,
});
export type InspectionInput = z.infer<typeof inspectionInputSchema>;

export function inspectionInputToRow(input: InspectionInput) {
  return {
    start_date: input.start_date ?? null,
    end_date: input.end_date ?? null,
    mileage: input.mileage ?? null,
    cost: input.cost ?? null,
    notes: input.notes ?? null,
    trust_label: input.trust_label,
  };
}

export type { TrustLevel };

import * as z from "zod";

// -----------------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------------
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

export const CURRENCIES = ["ILS", "USD", "EUR"] as const;
export type Currency = (typeof CURRENCIES)[number];

// -----------------------------------------------------------------------------
// Row shape (what we read back from Supabase). DB column names are kept as-is:
//   performed_at = the service date, service_type = the category.
// -----------------------------------------------------------------------------
export interface MaintenanceLog {
  id: string;
  owner_user_id: string;
  vehicle_id: string;
  performed_at: string | null;
  mileage: number | null;
  service_type: string | null;
  description: string | null;
  cost: number | null;
  currency: string;
  trust_label: TrustLevel;
  source_type: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export const MAINTENANCE_COLUMNS =
  "id, owner_user_id, vehicle_id, performed_at, mileage, service_type, description, cost, currency, trust_label, source_type, created_at, updated_at, deleted_at";

// -----------------------------------------------------------------------------
// Validation — error messages are translation keys (under `maintenance.form.errors`).
// The schema is the single source of truth on client (RHF) and server.
// -----------------------------------------------------------------------------
const emptyToUndefined = (v: unknown) =>
  typeof v === "string" && v.trim() === "" ? undefined : v;

export const maintenanceInputSchema = z.object({
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
  category: z.preprocess(
    emptyToUndefined,
    z.string().trim().max(80, { error: "tooLong" }).optional(),
  ),
  description: z
    .string({ error: "required" })
    .trim()
    .min(1, { error: "required" })
    .max(2000, { error: "tooLong" }),
  cost: z.preprocess(
    emptyToUndefined,
    z.coerce
      .number({ error: "invalidCost" })
      .min(0, { error: "invalidCost" })
      .max(100_000_000, { error: "invalidCost" })
      .optional(),
  ),
  currency: z.enum(CURRENCIES).default("ILS"),
  // Accept any known trust value (so editing legacy/AI rows works); the UI only
  // offers the selectable subset.
  trust_label: z.enum(TRUST_LEVELS).default("user_entered"),
});

/** Parsed/normalized maintenance input (server-side, ready to persist). */
export type MaintenanceInput = z.infer<typeof maintenanceInputSchema>;

/** Raw form field shape used by React Hook Form (text inputs are strings). */
export interface MaintenanceFormValues {
  date: string;
  mileage: string;
  category: string;
  description: string;
  cost: string;
  currency: Currency;
  trust_label: TrustLevel;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function emptyMaintenanceForm(): MaintenanceFormValues {
  return {
    date: todayIso(),
    mileage: "",
    category: "",
    description: "",
    cost: "",
    currency: "ILS",
    trust_label: "user_entered",
  };
}

/** Map a stored log into RHF default values (for the edit form). */
export function maintenanceToFormValues(
  m: MaintenanceLog,
): MaintenanceFormValues {
  return {
    date: m.performed_at ?? "",
    mileage: m.mileage != null ? String(m.mileage) : "",
    category: m.service_type ?? "",
    description: m.description ?? "",
    cost: m.cost != null ? String(m.cost) : "",
    currency: (CURRENCIES as readonly string[]).includes(m.currency)
      ? (m.currency as Currency)
      : "ILS",
    trust_label: m.trust_label,
  };
}

/** Convert validated input into a Supabase row payload (maps to DB columns). */
export function maintenanceInputToRow(input: MaintenanceInput) {
  return {
    performed_at: input.date,
    mileage: input.mileage ?? null,
    service_type: input.category ?? null,
    description: input.description,
    cost: input.cost ?? null,
    currency: input.currency,
    trust_label: input.trust_label,
  };
}

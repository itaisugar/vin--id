/**
 * Provider-neutral vehicle-lookup contract (Task D).
 *
 * The result is an explicit union so every caller handles every state. Raw
 * provider errors never reach the UI — they are mapped to `unavailable` with a
 * stable reason. The draft carries only VIN-ID-relevant, NON-PERSONAL fields;
 * owner identity is not representable here and must never be added.
 */

export type VehicleLookupSource = "israel_government";

/** Non-blocking data-quality signals attached to a found result. */
export type VehicleLookupWarning =
  | "registration_number_had_leading_zero"
  | "model_is_coded"
  | "test_expiry_unparseable"
  | "test_expiry_passed"
  | "partial_data";

/**
 * The mapped, editable draft. Every field is user-editable after retrieval and
 * nothing is authoritative until the user confirms. `_display` fields are shown
 * for context but are NOT written to the vehicle row in the MVP.
 */
export interface VehicleLookupDraft {
  registration_number: string | null;
  make: string | null;
  model: string | null;
  year: number | null;
  vin: string | null;
  color: string | null;
  fuel_type: string | null;
  test_expiry_date: string | null; // ISO YYYY-MM-DD or null
  /** Context only — not persisted in the MVP. */
  display: {
    last_test_date: string | null;
    ownership_type: string | null; // category (private/company) — NOT a name
  };
}

export type VehicleLookupUnavailableReason =
  | "timeout"
  | "provider_error"
  | "invalid_response"
  | "ambiguous"
  | "configuration";

export type VehicleLookupResult =
  | {
      status: "found";
      source: VehicleLookupSource;
      fetchedAt: string;
      resourceId: string;
      vehicle: VehicleLookupDraft;
      warnings: VehicleLookupWarning[];
    }
  | {
      status: "not_found";
      source: VehicleLookupSource;
      fetchedAt: string;
    }
  | {
      status: "unavailable";
      source: VehicleLookupSource;
      retryable: boolean;
      reason: VehicleLookupUnavailableReason;
    }
  | { status: "invalid_registration_number" };

/** Server configuration for the provider. Never exposed to the browser. */
export interface VehicleLookupConfig {
  baseUrl: string; // e.g. https://data.gov.il/api/3/action/
  resourceId: string;
  timeoutMs: number;
  cacheTtlMs: number;
  notFoundCacheTtlMs: number;
}

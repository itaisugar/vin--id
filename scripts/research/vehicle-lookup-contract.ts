/**
 * TASK C research spike — provider-neutral vehicle-lookup contract (TYPE ONLY).
 *
 * This file is RESEARCH, not production code. It is isolated under
 * scripts/research and is imported by nothing in the app or the build. It exists
 * so the recommended adapter shape can be reviewed as real TypeScript before any
 * implementation is scheduled. Do NOT import it from app/ or lib/.
 *
 * Design goals it encodes:
 *   - a narrow, provider-neutral result union (found | not_found | unavailable |
 *     invalid) so callers handle every state explicitly;
 *   - a draft that contains ONLY VIN-ID-relevant, non-personal fields;
 *   - per-field source metadata + warnings so a future Review screen can show
 *     provenance and let the user choose the final value;
 *   - no owner identity anywhere in the type — it is not representable.
 */

/** The only provider in scope for the MVP. */
export type VehicleLookupSource = "israel_government";

/** Why a draft field is what it is — drives the future conflict/Review UI. */
export interface FieldProvenance<T> {
  value: T | null;
  /** Which provider produced it (government here; document-AI later). */
  source: VehicleLookupSource | "document_ai" | "user";
  /** Low when the source field is coded/ambiguous (e.g. model code, not name). */
  confidence: "high" | "medium" | "low";
}

/** Non-blocking data-quality signals attached to a found draft. */
export type VehicleLookupWarning =
  | "registration_number_had_leading_zero"
  | "model_is_coded_degem_nm"
  | "tokef_dt_unparseable"
  | "first_road_date_is_month_precision"
  | "multiple_records_returned";

/**
 * The mapped, editable draft. Every field is user-editable after retrieval;
 * nothing here is authoritative until the user confirms. Owner identity fields
 * are intentionally absent and must never be added.
 */
export interface VehicleLookupDraft {
  // Identify (MVP: written to the draft, user-editable)
  license_plate: string | null;
  make: string | null;
  model: string | null;
  year: number | null;
  vin: string | null;
  color: string | null;
  fuel_type: string | null;
  // Compliance (MVP)
  test_expiry_date: string | null; // ISO YYYY-MM-DD or null
  // Display-only / future (NOT written to the vehicle row in the MVP)
  display: {
    model_code: string | null;
    engine_model: string | null;
    last_test_date: string | null;
    first_road: { year: number; month: number } | null;
    tyre_front: string | null;
    tyre_rear: string | null;
    ownership_type: string | null; // category (private/company) — NOT a name
    country_of_manufacture: string | null;
    import_type: string | null;
  };
  /** Optional per-field provenance for the future Review screen. */
  provenance?: Partial<
    Record<keyof Omit<VehicleLookupDraft, "display" | "provenance" | "warnings">, FieldProvenance<unknown>>
  >;
  warnings: VehicleLookupWarning[];
}

/** Result union — callers must handle every arm. */
export type VehicleLookupResult =
  | {
      status: "found";
      source: VehicleLookupSource;
      fetchedAt: string; // ISO timestamp of the lookup
      resourceId: string; // which DataStore resource answered
      vehicle: VehicleLookupDraft;
      warnings: VehicleLookupWarning[];
    }
  | {
      status: "not_found";
      source: VehicleLookupSource;
      fetchedAt: string;
      resourceId: string;
    }
  | {
      status: "unavailable";
      source: VehicleLookupSource;
      /** true for timeouts, 429 and 5xx; false for 4xx / malformed schema. */
      retryable: boolean;
      httpStatus?: number;
      reason?: "timeout" | "network_error" | "invalid_json" | "bad_envelope" | "malformed_records";
    }
  | { status: "invalid_registration_number"; reason: "empty" | "non_numeric" | "out_of_range" };

/** Adapter configuration — a fixed host + action are a security control. */
export interface VehicleLookupConfig {
  host: "https://data.gov.il";
  action: "/api/3/action/datastore_search";
  /** Resource ids are configurable (env) so a resource swap needs no redeploy. */
  primaryResourceId: string;
  filterField: "mispar_rechev";
  timeoutMs: number; // recommend 8000
  /** Conservative cache TTL for identical lookups. Recommend 15–60 min. */
  cacheTtlSeconds: number;
}

/** The single entry point a VIN-ID server route would call. */
export type VehicleLookupAdapter = (
  registration: string,
  config?: Partial<VehicleLookupConfig>,
) => Promise<VehicleLookupResult>;

/** Observability event shape (no plate/VIN in the payload — see security review). */
export interface VehicleLookupEvent {
  event: "vehicle_lookup";
  status: VehicleLookupResult["status"];
  resourceId?: string;
  latencyMs: number;
  retryable?: boolean;
  warningCount?: number;
  // NEVER include: registration number, VIN, raw provider response.
}

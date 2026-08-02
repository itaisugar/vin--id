import type { VehicleLookupDraft, VehicleLookupWarning } from "./types";

/**
 * Map ONE validated government record to a VIN-ID draft.
 *
 * Pure and deterministic. Handles the primary-resource schema (chassis field
 * `misgeret`). Only VIN-ID-relevant, non-personal fields are mapped; ownership
 * TYPE (`baalut`, e.g. private/company) is surfaced as low-value display text
 * and is NEVER treated as owner identity.
 */

/** A government record after runtime validation (all fields optional/unknown). */
export interface GovVehicleRecord {
  mispar_rechev?: string | number | null;
  tozeret_nm?: string | null;
  kinuy_mishari?: string | null;
  degem_nm?: string | null;
  shnat_yitzur?: string | number | null;
  tzeva_rechev?: string | null;
  sug_delek_nm?: string | null;
  misgeret?: string | null;
  tokef_dt?: string | null;
  mivchan_acharon_dt?: string | null;
  baalut?: string | null;
}

const trimOrNull = (v: unknown): string | null => {
  if (v == null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
};

/** Parse a full ISO date (YYYY-MM-DD) only. Month-only / garbage -> null. */
export function parseFullIsoDate(raw: unknown): string | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : s;
}

export interface MappedGovVehicle {
  vehicle: VehicleLookupDraft;
  warnings: VehicleLookupWarning[];
}

export function mapGovernmentVehicle(record: GovVehicleRecord): MappedGovVehicle {
  const warnings: VehicleLookupWarning[] = [];

  const plate = trimOrNull(record.mispar_rechev);
  if (plate && /^0\d+$/.test(plate)) {
    warnings.push("registration_number_had_leading_zero");
  }

  // Model: prefer the human commercial name, fall back to the coded model name.
  const commercial = trimOrNull(record.kinuy_mishari);
  const coded = trimOrNull(record.degem_nm);
  const model = commercial ?? coded;
  if (!commercial && coded) warnings.push("model_is_coded");

  const testExpiryRaw = trimOrNull(record.tokef_dt);
  const test_expiry_date = parseFullIsoDate(record.tokef_dt);
  if (testExpiryRaw && !test_expiry_date) warnings.push("test_expiry_unparseable");
  if (test_expiry_date && test_expiry_date < new Date().toISOString().slice(0, 10)) {
    warnings.push("test_expiry_passed");
  }

  const year =
    record.shnat_yitzur != null && String(record.shnat_yitzur).trim() !== ""
      ? Number(record.shnat_yitzur)
      : null;

  const vehicle: VehicleLookupDraft = {
    registration_number: plate,
    make: trimOrNull(record.tozeret_nm),
    model,
    year: year != null && Number.isFinite(year) ? year : null,
    vin: trimOrNull(record.misgeret),
    color: trimOrNull(record.tzeva_rechev),
    fuel_type: trimOrNull(record.sug_delek_nm),
    test_expiry_date,
    display: {
      last_test_date: parseFullIsoDate(record.mivchan_acharon_dt),
      ownership_type: trimOrNull(record.baalut),
    },
  };

  // A "found" record missing any core identifying field is partial.
  if (!vehicle.make || !vehicle.model || vehicle.year == null) {
    warnings.push("partial_data");
  }

  return { vehicle, warnings };
}

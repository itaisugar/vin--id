import { registrationDuplicateKey } from "@/lib/vehicle-lookup/normalize-registration";
import type { VehicleLookupDraft } from "@/lib/vehicle-lookup/types";
import type { VehicleRegistrationExtraction } from "./extraction-types";

/**
 * Source comparison for the Review screen (PURE).
 *
 * Compares the registration-document proposal with the official government
 * proposal, field by field, and computes an initial default value. It never
 * silently overwrites one source with the other — conflicts are surfaced and the
 * user's confirmed value is always final. This module has no I/O and is fully
 * unit-tested.
 */

export type FieldSourceStatus =
  | "match"
  | "conflict"
  | "document_only"
  | "government_only"
  | "missing";

export const COMPARED_FIELDS = [
  "registration_number",
  "make",
  "model",
  "year",
  "vin",
  "color",
  "fuel_type",
  "test_expiry_date",
] as const;
export type ComparedField = (typeof COMPARED_FIELDS)[number];

export interface FieldComparison {
  field: ComparedField;
  document: string | null;
  government: string | null;
  proposed: string | null;
  status: FieldSourceStatus;
  /** confidence of the document proposal (0..1), when available. */
  documentConfidence: number | null;
}

export interface VehicleSourceComparison {
  fields: Record<ComparedField, FieldComparison>;
  /** Registration numbers disagree — confirmation must be blocked until resolved. */
  registrationConflict: boolean;
  /** VIN/chassis disagree — must be explicitly reviewed. */
  vinConflict: boolean;
  /** Test-expiry dates disagree — highlight. */
  testExpiryConflict: boolean;
}

const s = (v: unknown): string | null => {
  if (v == null) return null;
  const t = String(v).trim();
  return t === "" ? null : t;
};

/** Normalized equality per field type. */
function sameValue(field: ComparedField, a: string | null, b: string | null): boolean {
  if (a == null || b == null) return false;
  if (field === "registration_number") {
    return registrationDuplicateKey(a) === registrationDuplicateKey(b) &&
      registrationDuplicateKey(a) !== null;
  }
  if (field === "vin") {
    const norm = (x: string) => x.toUpperCase().replace(/[^A-Z0-9]/g, "");
    return norm(a) === norm(b) && norm(a) !== "";
  }
  if (field === "year" || field === "test_expiry_date") return a === b;
  return a.toLowerCase() === b.toLowerCase();
}

function documentDraft(ex: VehicleRegistrationExtraction): Record<ComparedField, { value: string | null; confidence: number | null }> {
  return {
    registration_number: { value: s(ex.registration_number.value), confidence: ex.registration_number.confidence },
    make: { value: s(ex.make.value), confidence: ex.make.confidence },
    model: { value: s(ex.model.value), confidence: ex.model.confidence },
    year: { value: ex.year.value != null ? String(ex.year.value) : null, confidence: ex.year.confidence },
    vin: { value: s(ex.vin.value), confidence: ex.vin.confidence },
    color: { value: s(ex.color.value), confidence: ex.color.confidence },
    fuel_type: { value: s(ex.fuel_type.value), confidence: ex.fuel_type.confidence },
    test_expiry_date: { value: s(ex.test_expiry_date.value), confidence: ex.test_expiry_date.confidence },
  };
}

function governmentValue(gov: VehicleLookupDraft | null, field: ComparedField): string | null {
  if (!gov) return null;
  switch (field) {
    case "registration_number": return s(gov.registration_number);
    case "make": return s(gov.make);
    case "model": return s(gov.model);
    case "year": return gov.year != null ? String(gov.year) : null;
    case "vin": return s(gov.vin);
    case "color": return s(gov.color);
    case "fuel_type": return s(gov.fuel_type);
    case "test_expiry_date": return s(gov.test_expiry_date);
  }
}

/**
 * Compare document and government proposals. Default proposal rule:
 *   1. if both agree → that value
 *   2. else the government value when present
 *   3. else the document value
 *   4. else blank
 * Conflicts are flagged (never silently resolved); the user picks the final value.
 */
export function compareVehicleSources(
  extraction: VehicleRegistrationExtraction,
  government: VehicleLookupDraft | null,
): VehicleSourceComparison {
  const doc = documentDraft(extraction);
  const fields = {} as Record<ComparedField, FieldComparison>;
  let registrationConflict = false;
  let vinConflict = false;
  let testExpiryConflict = false;

  for (const field of COMPARED_FIELDS) {
    const d = doc[field].value;
    const g = governmentValue(government, field);
    let status: FieldSourceStatus;
    let proposed: string | null;

    if (d == null && g == null) {
      status = "missing";
      proposed = null;
    } else if (d != null && g == null) {
      status = "document_only";
      proposed = d;
    } else if (d == null && g != null) {
      status = "government_only";
      proposed = g;
    } else if (sameValue(field, d, g)) {
      status = "match";
      proposed = g; // identical; prefer canonical government form
    } else {
      status = "conflict";
      proposed = g; // default to government, but flagged for review
      if (field === "registration_number") registrationConflict = true;
      if (field === "vin") vinConflict = true;
      if (field === "test_expiry_date") testExpiryConflict = true;
    }

    fields[field] = {
      field,
      document: d,
      government: g,
      proposed,
      status,
      documentConfidence: doc[field].confidence,
    };
  }

  return { fields, registrationConflict, vinConflict, testExpiryConflict };
}

/** The overall data_source for a confirmed vehicle, given which sources contributed. */
export function resolveConfirmedDataSource(usedGovernment: boolean): "vehicle_registration_ai" | "mixed_confirmed" {
  return usedGovernment ? "mixed_confirmed" : "vehicle_registration_ai";
}

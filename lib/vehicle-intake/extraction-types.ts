import * as z from "zod";
import { normalizeToIsoDate } from "@/lib/documents/scan/types";

/**
 * Vehicle-registration extraction — types + strict runtime validation.
 *
 * ALLOWLIST + PII EXCLUSION. The document image may contain the owner's name, ID
 * number and address. Structured extraction takes ONLY the allowlisted
 * vehicle-identity fields below; any prohibited personal key that appears in the
 * model output is dropped before validation and never persisted or returned. No
 * full OCR text is ever kept.
 *
 * Each field is a proposal: { value, confidence }. Confidence is numeric 0..1
 * when the provider supplies it, else null (treated as "needs review").
 */

export const VEHICLE_DOC_TYPES = ["vehicle_registration", "other", "uncertain"] as const;
export type VehicleDocType = (typeof VEHICLE_DOC_TYPES)[number];

export const EXTRACTION_VERSION = "vehreg-1";

/** Keys that must never be persisted or returned, even if the model emits them. */
export const PROHIBITED_PII_KEYS = [
  "owner_name",
  "owner",
  "name",
  "full_name",
  "id_number",
  "identity_number",
  "national_id",
  "tz",
  "address",
  "phone",
  "phone_number",
  "email",
  "signature",
  "previous_owner",
] as const;

export interface ExtractedField<T> {
  value: T | null;
  confidence: number | null;
}

export interface VehicleRegistrationExtraction {
  document_type: VehicleDocType;
  document_type_confidence: number | null;
  registration_number: ExtractedField<string>;
  make: ExtractedField<string>;
  model: ExtractedField<string>;
  year: ExtractedField<number>;
  vin: ExtractedField<string>;
  color: ExtractedField<string>;
  fuel_type: ExtractedField<string>;
  test_expiry_date: ExtractedField<string>; // ISO yyyy-mm-dd or null
  warnings: string[];
  /** Redacted note if prohibited PII keys were seen and dropped. */
  pii_stripped: boolean;
  extraction_version: string;
}

// ---- coercion helpers (tolerant; a bad single field never fails the whole doc)
const num = (v: unknown): number | null => {
  if (v == null) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") {
    const c = v.replace(/[^0-9.\-]/g, "");
    if (!c) return null;
    const n = Number(c);
    return Number.isFinite(n) ? n : null;
  }
  return null;
};
const str = (v: unknown, max: number): string | null => {
  if (typeof v !== "string") return v == null ? null : String(v).trim().slice(0, max) || null;
  const s = v.trim();
  return s ? s.slice(0, max) : null;
};
const conf = (v: unknown): number | null => {
  const n = num(v);
  return n == null ? null : Math.min(1, Math.max(0, n));
};

/** A raw field may be a bare value or a {value, confidence} object. */
function field<T>(raw: unknown, coerce: (v: unknown) => T | null): ExtractedField<T> {
  if (raw && typeof raw === "object" && !Array.isArray(raw) && "value" in (raw as object)) {
    const r = raw as { value?: unknown; confidence?: unknown };
    return { value: coerce(r.value), confidence: conf(r.confidence) };
  }
  return { value: coerce(raw), confidence: null };
}

/**
 * Strip prohibited PII keys anywhere in the object (shallow + one level of
 * nesting is enough for our flat schema). Returns whether anything was removed.
 */
export function stripProhibitedKeys(raw: unknown): { cleaned: Record<string, unknown>; removed: boolean } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { cleaned: {}, removed: false };
  let removed = false;
  const prohibited = new Set<string>(PROHIBITED_PII_KEYS as readonly string[]);
  const walk = (obj: Record<string, unknown>): Record<string, unknown> => {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (prohibited.has(k.toLowerCase())) {
        removed = true;
        continue;
      }
      out[k] = v && typeof v === "object" && !Array.isArray(v) ? walk(v as Record<string, unknown>) : v;
    }
    return out;
  };
  return { cleaned: walk(raw as Record<string, unknown>), removed };
}

const YEAR_MIN = 1900;
const YEAR_MAX = new Date().getFullYear() + 1;

/**
 * Parse + validate raw provider output into a safe extraction. Never throws for
 * missing/odd fields — only genuinely non-object input is rejected by the caller.
 * Unknown keys are ignored; prohibited PII keys are stripped first.
 */
export function parseVehicleRegistrationExtraction(raw: unknown): VehicleRegistrationExtraction {
  const { cleaned, removed } = stripProhibitedKeys(raw);

  const docTypeRaw = cleaned.document_type;
  const document_type: VehicleDocType =
    typeof docTypeRaw === "string" && (VEHICLE_DOC_TYPES as readonly string[]).includes(docTypeRaw)
      ? (docTypeRaw as VehicleDocType)
      : "uncertain";

  const yearField = field<number>(cleaned.year, (v) => {
    const n = num(v);
    return n != null && n >= YEAR_MIN && n <= YEAR_MAX ? Math.round(n) : null;
  });

  const warnings = Array.isArray(cleaned.warnings)
    ? cleaned.warnings.filter((w): w is string => typeof w === "string").slice(0, 20)
    : [];
  if (removed) warnings.push("prohibited_fields_removed");

  return {
    document_type,
    document_type_confidence: conf(cleaned.document_type_confidence),
    registration_number: field<string>(cleaned.registration_number, (v) => str(v, 40)),
    make: field<string>(cleaned.make, (v) => str(v, 60)),
    model: field<string>(cleaned.model, (v) => str(v, 60)),
    year: yearField,
    vin: field<string>(cleaned.vin, (v) => str(v, 40)),
    color: field<string>(cleaned.color, (v) => str(v, 40)),
    fuel_type: field<string>(cleaned.fuel_type, (v) => str(v, 40)),
    test_expiry_date: field<string>(cleaned.test_expiry_date, (v) => {
      const raw = typeof v === "string" ? v.trim() : v == null ? null : String(v).trim();
      // Never manufacture a day from a month-only value (e.g. "2027-03", "03/2027").
      if (raw && /^\d{4}-\d{1,2}$/.test(raw)) return null;
      if (raw && /^\d{1,2}[/.]\d{4}$/.test(raw)) return null;
      return normalizeToIsoDate(raw);
    }),
    warnings,
    pii_stripped: removed,
    extraction_version: EXTRACTION_VERSION,
  };
}

/** A tiny runtime guard for the top-level shape from a provider. */
export const rawExtractionSchema = z.object({}).passthrough();

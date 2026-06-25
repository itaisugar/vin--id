import * as z from "zod";
import { CURRENCIES, TRUST_LEVELS, type Currency } from "@/lib/maintenance/types";
import type { MileageUnit } from "@/lib/vehicles/types";
import {
  ISSUE_SEVERITIES,
  ISSUE_STATUSES,
  type IssueSeverity,
  type IssueStatus,
} from "@/lib/issues/types";

/**
 * Types for the "Scan a document" flow: a scanned image is sent (server-side)
 * to a DocumentExtractionProvider, which FIRST classifies the document into one
 * of four categories, THEN extracts only that category's fields. The user then
 * confirms a PRE-FILLED, editable record before anything is saved.
 *
 * This is a separate concern from `lib/documents/extraction-*` (which fills
 * document METADATA). Here the confirmed result becomes a maintenance / issue /
 * insurance / registration / inspection record via dedicated create flows.
 */

// -----------------------------------------------------------------------------
// Classifier output. `document_category` decides which fields are extracted.
// "unknown" routes the user to manual category selection. The provider must
// never invent values — null for anything absent.
// -----------------------------------------------------------------------------
export const DOCUMENT_CATEGORIES = [
  "maintenance",
  "insurance",
  "registration",
  "inspection",
  "unknown",
] as const;
export type DocumentCategory = (typeof DOCUMENT_CATEGORIES)[number];

/** Image media types we send to the provider (PDF is not supported here). */
export const SCAN_IMAGE_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;
export type ScanImageMime = (typeof SCAN_IMAGE_MIME_TYPES)[number];

/** Largest scan we accept from the client (before server-side downscaling). */
export const MAX_SCAN_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

export function isScanImageMime(mime: string): mime is ScanImageMime {
  return (SCAN_IMAGE_MIME_TYPES as readonly string[]).includes(mime);
}

/**
 * Best-effort normalize a model-provided date to ISO yyyy-mm-dd. The model is
 * asked for ISO but may echo the document's format (e.g. dd/mm/yyyy, common on
 * Israeli receipts). Returns null when it can't be confidently parsed — never
 * throws. The confirmation form keeps the date editable either way, so a missed
 * parse never blocks the user.
 */
export function normalizeToIsoDate(
  raw: string | null | undefined,
): string | null {
  if (!raw) return null;
  const s = raw.trim();
  if (!s) return null;

  // Build + validate an ISO string, rejecting impossible dates (e.g. 31/02).
  const iso = (y: number, m: number, d: number): string | null => {
    const dt = new Date(Date.UTC(y, m - 1, d));
    if (
      dt.getUTCFullYear() !== y ||
      dt.getUTCMonth() !== m - 1 ||
      dt.getUTCDate() !== d
    ) {
      return null;
    }
    return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  };

  // Already ISO (optionally with a time suffix).
  let mt = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (mt) return iso(+mt[1], +mt[2], +mt[3]);

  // yyyy/mm/dd or yyyy.mm.dd
  mt = s.match(/^(\d{4})[/.](\d{1,2})[/.](\d{1,2})$/);
  if (mt) return iso(+mt[1], +mt[2], +mt[3]);

  // dd/mm/yyyy or mm/dd/yyyy (4-digit year last). Prefer day-first (EN/HE);
  // disambiguate when one component is > 12.
  mt = s.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})$/);
  if (mt) {
    const a = +mt[1];
    const b = +mt[2];
    const y = +mt[3];
    let day: number;
    let month: number;
    if (a > 12 && b <= 12) {
      day = a;
      month = b;
    } else if (b > 12 && a <= 12) {
      day = b;
      month = a;
    } else {
      day = a; // ambiguous → day-first
      month = b;
    }
    return iso(y, month, day);
  }

  // Textual formats ("March 12, 2026", "12 Mar 2026"): use local components so
  // the calendar date isn't shifted by the timezone.
  const parsed = new Date(s);
  if (!Number.isNaN(parsed.getTime())) {
    return iso(parsed.getFullYear(), parsed.getMonth() + 1, parsed.getDate());
  }

  return null;
}

// -----------------------------------------------------------------------------
// Tolerant field coercion. The model is asked for the right types, but a single
// odd value (a number as a string, a stray unit) must never fail the whole
// extraction — we null bad/out-of-range values instead.
// -----------------------------------------------------------------------------
function toNumberOrNull(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") {
    const cleaned = v.replace(/[^0-9.\-]/g, "");
    if (!cleaned) return null;
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function toStringOrNull(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s ? s : null;
}

const dateField = z
  .any()
  .transform((v) =>
    normalizeToIsoDate(
      typeof v === "string" ? v : v == null ? null : String(v),
    ),
  );

const mileageField = z.any().transform((v) => {
  const n = toNumberOrNull(v);
  return n != null && n >= 0 && n <= 10_000_000 ? Math.round(n) : null;
});

const costField = z.any().transform((v) => {
  const n = toNumberOrNull(v);
  return n != null && n >= 0 && n <= 100_000_000 ? n : null;
});

const textField = (max: number) =>
  z.any().transform((v) => {
    const s = toStringOrNull(v);
    return s ? s.slice(0, max) : null;
  });

const confidenceField = z.any().transform((v) => {
  const n = toNumberOrNull(v);
  return n == null ? null : Math.min(1, Math.max(0, n));
});

// -----------------------------------------------------------------------------
// Discriminated union on `document_category`. Each variant carries ONLY its own
// fields. Validation never rejects on bad field types (fields are coerced); the
// only hard requirement is a valid discriminator, which the providers ensure via
// `coerceCategory` before parsing.
// -----------------------------------------------------------------------------
export const scanExtractionSchema = z.discriminatedUnion("document_category", [
  z.object({
    document_category: z.literal("maintenance"),
    date: dateField,
    garage_name: textField(120),
    mileage: mileageField,
    service_type: textField(120),
    service_details: textField(2000),
    confidence: confidenceField,
  }),
  z.object({
    document_category: z.literal("insurance"),
    insurer_name: textField(120),
    start_date: dateField,
    end_date: dateField,
    cost: costField,
    insurance_type: textField(120),
    confidence: confidenceField,
  }),
  z.object({
    document_category: z.literal("registration"),
    start_date: dateField,
    end_date: dateField,
    mileage: mileageField,
    notes: textField(2000),
    confidence: confidenceField,
  }),
  z.object({
    document_category: z.literal("inspection"),
    start_date: dateField,
    end_date: dateField,
    mileage: mileageField,
    cost: costField,
    notes: textField(2000),
    confidence: confidenceField,
  }),
  z.object({
    document_category: z.literal("unknown"),
    confidence: confidenceField,
  }),
]);

/**
 * A validity range must never have its end before its start. The classifier
 * occasionally swaps "valid from" / "valid until" (or echoes them in document
 * order), which produced records whose end date preceded their start date.
 * Used both to order the pre-filled form and as an authoritative save guard.
 * Returns true when the range is valid or either date is absent.
 */
function isOrderedDateRange(v: {
  start_date?: string | null;
  end_date?: string | null;
}): boolean {
  if (!v.start_date || !v.end_date) return true;
  const start = Date.parse(v.start_date);
  const end = Date.parse(v.end_date);
  if (Number.isNaN(start) || Number.isNaN(end)) return true;
  return start <= end;
}

/**
 * Order a validity range for pre-fill so the start is never after the end. When
 * both dates are present and inverted we swap them (the most likely correction
 * for a classifier that confused "valid from" / "valid until"); the user still
 * reviews and can override. Missing dates become empty strings.
 */
function orderedRange(
  start: string | null,
  end: string | null,
): { start: string; end: string } {
  if (!isOrderedDateRange({ start_date: start, end_date: end })) {
    return { start: end ?? "", end: start ?? "" };
  }
  return { start: start ?? "", end: end ?? "" };
}

/** Validated, normalized extraction result (one of the four categories). */
export type ScanExtraction = z.infer<typeof scanExtractionSchema>;

/**
 * Coerce an unrecognized / missing `document_category` to "unknown" so the
 * discriminated union always has a valid discriminator. Providers call this
 * before parsing so a surprising classifier value degrades to manual entry
 * instead of throwing.
 */
export function coerceCategory(raw: unknown): unknown {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const r = raw as Record<string, unknown>;
    const cat = r.document_category;
    if (
      typeof cat !== "string" ||
      !(DOCUMENT_CATEGORIES as readonly string[]).includes(cat)
    ) {
      return { ...r, document_category: "unknown" };
    }
  }
  return raw;
}

/** Parse provider output, tolerating an unknown category. Throws on non-object. */
export function parseScanExtraction(raw: unknown): ScanExtraction {
  return scanExtractionSchema.parse(coerceCategory(raw));
}

/** What the extraction endpoint returns to the client. */
export interface ScanExtractionResponse {
  extraction: ScanExtraction;
  /** Which provider produced this (drives the "mock" notice in the UI). */
  engine: "mock" | "anthropic";
}

// -----------------------------------------------------------------------------
// Confirmation form — a single editable form covering every category. The user
// may CORRECT the category, which swaps the visible field set. On submit the
// values are mapped to the matching create flow server-side. "issue" is kept as
// a selectable category so the existing issue path stays reachable, even though
// the classifier no longer auto-detects it.
// -----------------------------------------------------------------------------
export const SCAN_FORM_CATEGORIES = [
  "maintenance",
  "insurance",
  "registration",
  "inspection",
  "issue",
] as const;
export type ScanFormCategory = (typeof SCAN_FORM_CATEGORIES)[number];

/**
 * Descriptor for the ORIGINAL uploaded scan image, persisted via the existing
 * documents pipeline. The client uploads the original file straight to Storage
 * (same browser-upload pattern as the documents module, to avoid the
 * server-action body limit), then passes this descriptor to the create action
 * which inserts the vehicle_documents row and links the record to it.
 *
 * `storage_path` is only ever produced/consumed server-side and inside the
 * authenticated client upload; it is never rendered in the UI.
 */
export interface ScanDocumentDescriptor {
  documentId: string;
  storage_path: string;
  file_name: string;
  mime_type: string;
  file_size: number;
}

export interface ScanConfirmFormValues {
  category: ScanFormCategory;
  // maintenance + issue share a date / mileage / free-text body
  date: string;
  mileage: string;
  /** Unit the entered mileage is in; converted to the vehicle's unit on save. */
  mileage_unit: MileageUnit;
  /** maintenance service_details OR issue symptoms. */
  description: string;
  // maintenance
  service_type: string;
  garage_name: string;
  // shared money (maintenance / insurance / inspection)
  cost: string;
  currency: Currency;
  // insurance
  insurer_name: string;
  insurance_type: string;
  // insurance / registration / inspection validity range
  start_date: string;
  end_date: string;
  // registration / inspection
  notes: string;
  // issue
  severity: IssueSeverity;
  status: IssueStatus;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function emptyForm(): ScanConfirmFormValues {
  return {
    category: "maintenance",
    date: todayIso(),
    mileage: "",
    mileage_unit: "km",
    description: "",
    service_type: "",
    garage_name: "",
    cost: "",
    currency: "ILS",
    insurer_name: "",
    insurance_type: "",
    start_date: "",
    end_date: "",
    notes: "",
    severity: "monitor",
    status: "open",
  };
}

const numToStr = (n: number | null): string => (n != null ? String(n) : "");

/**
 * Build pre-filled, fully-editable form defaults from an extraction. Only the
 * detected category's fields are populated; "unknown" falls back to an empty
 * maintenance form so the user can pick the right category manually.
 */
export function extractionToScanForm(
  extraction: ScanExtraction,
): ScanConfirmFormValues {
  const form = emptyForm();

  switch (extraction.document_category) {
    case "maintenance":
      form.category = "maintenance";
      form.date = extraction.date ?? todayIso();
      form.mileage = numToStr(extraction.mileage);
      form.service_type = extraction.service_type ?? "";
      form.garage_name = extraction.garage_name ?? "";
      form.description = extraction.service_details ?? "";
      return form;
    case "insurance": {
      form.category = "insurance";
      form.insurer_name = extraction.insurer_name ?? "";
      form.insurance_type = extraction.insurance_type ?? "";
      const range = orderedRange(extraction.start_date, extraction.end_date);
      form.start_date = range.start;
      form.end_date = range.end;
      form.cost = numToStr(extraction.cost);
      return form;
    }
    case "registration": {
      form.category = "registration";
      const range = orderedRange(extraction.start_date, extraction.end_date);
      form.start_date = range.start;
      form.end_date = range.end;
      form.mileage = numToStr(extraction.mileage);
      form.notes = extraction.notes ?? "";
      return form;
    }
    case "inspection": {
      form.category = "inspection";
      const range = orderedRange(extraction.start_date, extraction.end_date);
      form.start_date = range.start;
      form.end_date = range.end;
      form.mileage = numToStr(extraction.mileage);
      form.cost = numToStr(extraction.cost);
      form.notes = extraction.notes ?? "";
      return form;
    }
    case "unknown":
    default:
      return form; // empty maintenance default; UI prompts for a category
  }
}

/** Confidence buckets for the UI badge (the provider returns a 0..1 number). */
export function confidenceBucket(
  confidence: number | null,
): "low" | "medium" | "high" {
  if (confidence == null) return "low";
  if (confidence >= 0.75) return "high";
  if (confidence >= 0.45) return "medium";
  return "low";
}

// Re-export the enums the confirm form iterates over, so the client component
// has a single import surface for this feature.
export { ISSUE_SEVERITIES, ISSUE_STATUSES, CURRENCIES, TRUST_LEVELS };
export type { IssueSeverity, IssueStatus, Currency };

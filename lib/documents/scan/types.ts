import * as z from "zod";
import { CURRENCIES, type Currency } from "@/lib/maintenance/types";
import {
  ISSUE_SEVERITIES,
  ISSUE_STATUSES,
  type IssueSeverity,
  type IssueStatus,
} from "@/lib/issues/types";

/**
 * Types for the "Scan a document" flow: a scanned image is sent (server-side)
 * to a DocumentExtractionProvider, which returns the structured shape below.
 * The user then confirms a PRE-FILLED, editable record before anything is saved.
 *
 * This is a separate concern from `lib/documents/extraction-*` (which fills
 * document METADATA). Here the confirmed result becomes a maintenance OR issue
 * record via the existing create flows.
 */

// -----------------------------------------------------------------------------
// The structured JSON the provider must return. `document_type_guess` classifies
// the document to a target RECORD type. Unknown / absent values are null — the
// provider must never invent values.
// -----------------------------------------------------------------------------
export const RECORD_TYPE_GUESSES = [
  "maintenance",
  "issue",
  "unknown",
] as const;
export type RecordTypeGuess = (typeof RECORD_TYPE_GUESSES)[number];

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
 * throws. The confirmation form keeps the date editable either way (it defaults
 * to today when null), so a missed parse never blocks the user.
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
    return iso(
      parsed.getFullYear(),
      parsed.getMonth() + 1,
      parsed.getDate(),
    );
  }

  return null;
}

/**
 * Schema the provider output is validated against (after stripping code fences
 * and JSON.parse). Loose-but-safe: out-of-range numbers are nulled rather than
 * rejected so a single bad field never fails the whole extraction.
 */
export const scanExtractionSchema = z.object({
  date: z
    .string()
    .nullable()
    .transform((v) => normalizeToIsoDate(v)),
  service_or_work_description: z
    .string()
    .nullable()
    .transform((v) => (v ? v.slice(0, 2000) : null)),
  mileage: z
    .number()
    .nullable()
    .transform((v) =>
      v != null && Number.isFinite(v) && v >= 0 && v <= 10_000_000
        ? Math.round(v)
        : null,
    ),
  cost: z
    .number()
    .nullable()
    .transform((v) =>
      v != null && Number.isFinite(v) && v >= 0 && v <= 100_000_000 ? v : null,
    ),
  vendor: z
    .string()
    .nullable()
    .transform((v) => (v ? v.slice(0, 120) : null)),
  document_type_guess: z
    .enum(RECORD_TYPE_GUESSES)
    .catch("unknown"),
  confidence: z
    .number()
    .nullable()
    .transform((v) =>
      v != null && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : null,
    ),
});

/** Validated, normalized extraction result. */
export type ScanExtraction = z.infer<typeof scanExtractionSchema>;

/** What the extraction endpoint returns to the client. */
export interface ScanExtractionResponse {
  extraction: ScanExtraction;
  /** Which provider produced this (drives the "mock" notice in the UI). */
  engine: "mock" | "anthropic";
}

// -----------------------------------------------------------------------------
// Confirmation form — a single editable form covering both record types. On
// submit it is mapped to the existing maintenance/issue input schemas server-side.
// -----------------------------------------------------------------------------
export const SCAN_RECORD_TYPES = ["maintenance", "issue"] as const;
export type ScanRecordType = (typeof SCAN_RECORD_TYPES)[number];

export interface ScanConfirmFormValues {
  record_type: ScanRecordType;
  date: string;
  mileage: string;
  /** Maps to maintenance.description OR issue.symptoms. */
  description: string;
  // maintenance-only
  category: string;
  cost: string;
  currency: Currency;
  // issue-only
  severity: IssueSeverity;
  status: IssueStatus;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Build pre-filled, fully-editable form defaults from an extraction. The vendor
 * is folded into the description (maintenance has no vendor column) so the
 * extracted value is preserved and editable rather than lost.
 */
export function extractionToScanForm(
  extraction: ScanExtraction,
): ScanConfirmFormValues {
  const recordType: ScanRecordType =
    extraction.document_type_guess === "issue" ? "issue" : "maintenance";

  const baseDescription = extraction.service_or_work_description ?? "";
  const description =
    extraction.vendor && baseDescription
      ? `${baseDescription} (${extraction.vendor})`
      : (baseDescription || extraction.vendor || "");

  return {
    record_type: recordType,
    date: extraction.date ?? todayIso(),
    mileage: extraction.mileage != null ? String(extraction.mileage) : "",
    description,
    category: "",
    cost: extraction.cost != null ? String(extraction.cost) : "",
    currency: "ILS",
    severity: "monitor",
    status: "open",
  };
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
export { ISSUE_SEVERITIES, ISSUE_STATUSES, CURRENCIES };
export type { IssueSeverity, IssueStatus, Currency };

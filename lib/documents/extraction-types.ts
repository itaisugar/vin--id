import * as z from "zod";
import { CURRENCIES, DOCUMENT_TYPES } from "./types";
import type { Currency, DocumentType } from "./types";

// -----------------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------------
export const EXTRACTION_STATUSES = [
  "pending_confirmation",
  "confirmed",
  "discarded",
  "failed",
] as const;
export type ExtractionStatus = (typeof EXTRACTION_STATUSES)[number];

export const FIELD_CONFIDENCES = ["low", "medium", "high"] as const;
export type FieldConfidence = (typeof FIELD_CONFIDENCES)[number];

// -----------------------------------------------------------------------------
// Structured extraction result (stored in document_extractions.extracted_data).
// Same shape a future real provider will return.
// -----------------------------------------------------------------------------
export interface ExtractedField<T> {
  value: T | null;
  confidence: FieldConfidence;
  source: "mock";
}

export interface ExtractionFields {
  document_type: ExtractedField<DocumentType>;
  document_date: ExtractedField<string>;
  expiry_date: ExtractedField<string>;
  vendor: ExtractedField<string>;
  amount: ExtractedField<number>;
  currency: ExtractedField<Currency>;
  mileage: ExtractedField<number>;
}

export interface ExtractionResult {
  mock_mode: true;
  /** Translation-key codes (resolved in the UI), e.g. "mock_review". */
  warnings: string[];
  fields: ExtractionFields;
}

const field = <T extends z.ZodTypeAny>(value: T) =>
  z.object({
    value: value.nullable(),
    confidence: z.enum(FIELD_CONFIDENCES),
    source: z.literal("mock"),
  });

export const extractionResultSchema = z.object({
  mock_mode: z.literal(true),
  warnings: z.array(z.string()),
  fields: z.object({
    document_type: field(z.enum(DOCUMENT_TYPES)),
    document_date: field(z.string()),
    expiry_date: field(z.string()),
    vendor: field(z.string()),
    amount: field(z.number()),
    currency: field(z.enum(CURRENCIES)),
    mileage: field(z.number()),
  }),
});

// -----------------------------------------------------------------------------
// Confirm input — ONLY the fields that may be written to vehicle_documents.
// (No mileage column on documents; share_allowed / contains_personal_info /
// trust_label are deliberately never changed here.)
// -----------------------------------------------------------------------------
const emptyToUndefined = (v: unknown) =>
  typeof v === "string" && v.trim() === "" ? undefined : v;

const optionalDate = z.preprocess(
  emptyToUndefined,
  z
    .string()
    .refine((v) => !Number.isNaN(Date.parse(v)), { error: "invalidDate" })
    .optional(),
);

export const confirmExtractionSchema = z.object({
  document_type: z.enum(DOCUMENT_TYPES).default("other"),
  document_date: optionalDate,
  expiry_date: optionalDate,
  vendor: z.preprocess(
    emptyToUndefined,
    z.string().trim().max(120, { error: "tooLong" }).optional(),
  ),
  amount: z.preprocess(
    emptyToUndefined,
    z.coerce
      .number({ error: "invalidAmount" })
      .min(0, { error: "invalidAmount" })
      .max(100_000_000, { error: "invalidAmount" })
      .optional(),
  ),
  currency: z.enum(CURRENCIES).default("ILS"),
});
export type ConfirmExtractionInput = z.infer<typeof confirmExtractionSchema>;

export interface ConfirmExtractionFormValues {
  document_type: DocumentType;
  document_date: string;
  expiry_date: string;
  vendor: string;
  amount: string;
  currency: Currency;
}

/** Row shape for a pending extraction we render in the review panel. */
export interface DocumentExtraction {
  id: string;
  document_id: string;
  status: ExtractionStatus;
  extracted_data: ExtractionResult | Record<string, never>;
  created_at: string;
}

/** Map an ExtractionResult into review-form default values. */
export function extractionToFormValues(
  result: ExtractionResult,
  fallback: {
    document_type: DocumentType;
    document_date: string | null;
    expiry_date: string | null;
    vendor: string | null;
    amount: number | null;
    currency: string;
  },
): ConfirmExtractionFormValues {
  const f = result.fields;

  const fallbackCurrency = (CURRENCIES as readonly string[]).includes(
    fallback.currency,
  )
    ? (fallback.currency as Currency)
    : "ILS";

  return {
    document_type: f.document_type.value ?? fallback.document_type,
    document_date: f.document_date.value ?? fallback.document_date ?? "",
    expiry_date: f.expiry_date.value ?? fallback.expiry_date ?? "",
    vendor: f.vendor.value ?? fallback.vendor ?? "",
    amount:
      f.amount.value != null
        ? String(f.amount.value)
        : fallback.amount != null
          ? String(fallback.amount)
          : "",
    currency: f.currency.value ?? fallbackCurrency,
  };
}

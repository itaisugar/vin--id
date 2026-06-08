import "server-only";

import type {
  ExtractedField,
  ExtractionResult,
} from "@/lib/documents/extraction-types";
import type { Currency, DocumentType } from "@/lib/documents/types";

/**
 * MOCK document-extraction provider — deterministic, NO real AI/OCR, NO network,
 * NO API key. It infers fields from the document's type and file name only and
 * returns the SAME structured schema a future real provider will use (swap
 * point isolated to this file).
 *
 * IMPORTANT: this is NOT real extraction. Unknown fields are null with low
 * confidence — it never guesses. Results are never auto-applied (the user must
 * review and confirm).
 *
 * TODO(real-ocr): real OCR/text extraction. TODO(real-ai-provider): real model
 * behind this interface. TODO(field-source-highlighting): map fields to regions.
 * TODO(receipt-to-maintenance): suggest a maintenance record from receipts
 * (NOT implemented now — extraction must never auto-create records).
 */

export interface MockExtractionInput {
  docType: DocumentType;
  fileName: string | null;
  existingDocumentDate: string | null;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function plusOneYear(): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() + 1);
  return d.toISOString().slice(0, 10);
}

function f<T>(
  value: T | null,
  confidence: ExtractedField<T>["confidence"],
): ExtractedField<T> {
  return { value, confidence, source: "mock" };
}

type Category = "receipt" | "insurance" | "inspection" | "registration" | "other";

function classify(input: MockExtractionInput): Category {
  const name = (input.fileName ?? "").toLowerCase();
  const has = (...words: string[]) => words.some((w) => name.includes(w));

  if (input.docType === "invoice" || has("receipt", "invoice", "חשבונית", "קבלה")) {
    return "receipt";
  }
  if (input.docType === "insurance" || has("insurance", "ביטוח")) {
    return "insurance";
  }
  if (
    input.docType === "inspection" ||
    has("inspection", "test", "טסט", "בדיקה")
  ) {
    return "inspection";
  }
  if (
    input.docType === "registration" ||
    has("registration", "license", "רישיון", "רישוי")
  ) {
    return "registration";
  }
  return "other";
}

/** Run the deterministic mock extraction. Pure given the input. */
export function runMockDocumentExtraction(
  input: MockExtractionInput,
): ExtractionResult {
  const category = classify(input);
  const docDate = input.existingDocumentDate ?? today();

  const nullFields = {
    document_type: f<DocumentType>(null, "low"),
    document_date: f<string>(null, "low"),
    expiry_date: f<string>(null, "low"),
    vendor: f<string>(null, "low"),
    amount: f<number>(null, "low"),
    currency: f<Currency>(null, "low"),
    mileage: f<number>(null, "low"),
  };

  let fields = nullFields;

  switch (category) {
    case "receipt":
      fields = {
        ...nullFields,
        document_type: f<DocumentType>("invoice", "medium"),
        vendor: f<string>("Mock Garage", "medium"),
        amount: f<number>(450, "medium"),
        currency: f<Currency>("ILS", "medium"),
        document_date: f<string>(docDate, "low"),
      };
      break;
    case "insurance":
      fields = {
        ...nullFields,
        document_type: f<DocumentType>("insurance", "medium"),
        vendor: f<string>("Mock Insurance Provider", "medium"),
        expiry_date: f<string>(plusOneYear(), "medium"),
        document_date: f<string>(docDate, "low"),
      };
      break;
    case "inspection":
      fields = {
        ...nullFields,
        document_type: f<DocumentType>("inspection", "medium"),
        expiry_date: f<string>(plusOneYear(), "medium"),
        document_date: f<string>(docDate, "low"),
      };
      break;
    case "registration":
      fields = {
        ...nullFields,
        document_type: f<DocumentType>("registration", "medium"),
        expiry_date: f<string>(plusOneYear(), "low"),
        document_date: f<string>(docDate, "low"),
      };
      break;
    case "other":
      fields = {
        ...nullFields,
        // Keep the current type with low confidence; do not guess other fields.
        document_type: f<DocumentType>(input.docType, "low"),
      };
      break;
  }

  return {
    mock_mode: true,
    warnings: ["mock_review"],
    fields,
  };
}

import "server-only";

import type {
  DocumentExtractionInput,
  DocumentExtractionProvider,
} from "@/lib/documents/scan/provider";
import {
  parseScanExtraction,
  type ScanExtraction,
} from "@/lib/documents/scan/types";

/**
 * MOCK scanned-document extraction provider — deterministic, NO real AI/OCR, NO
 * network, NO API key. It returns the SAME discriminated-union schema the real
 * provider uses so swapping is isolated. This is the default whenever no
 * ANTHROPIC_API_KEY is configured.
 *
 * IMPORTANT: this is NOT real extraction. The values are fixed demo samples
 * (clearly labelled "mock" in the UI) and are never auto-saved — the user must
 * review and confirm a pre-filled, editable record. To make all four categories
 * testable, the sample is chosen deterministically from the image size, so
 * scanning different images can surface each category.
 */
export class MockExtractionProvider implements DocumentExtractionProvider {
  readonly engine = "mock" as const;

  async extract(input: DocumentExtractionInput): Promise<ScanExtraction> {
    const today = new Date().toISOString().slice(0, 10);
    const nextYear = new Date();
    nextYear.setFullYear(nextYear.getFullYear() + 1);
    const inAYear = nextYear.toISOString().slice(0, 10);

    // Deterministic per-image category so a tester can reach all four samples.
    const samples = [
      {
        document_category: "maintenance",
        date: today,
        garage_name: "Mock Garage",
        mileage: 82000,
        service_type: "Oil and filter change",
        service_details: "Oil and filter change (mock extraction)",
        confidence: 0.6,
      },
      {
        document_category: "insurance",
        insurer_name: "Mock Insurance Co.",
        start_date: today,
        end_date: inAYear,
        cost: 2400,
        insurance_type: "Comprehensive",
        confidence: 0.6,
      },
      {
        document_category: "registration",
        start_date: today,
        end_date: inAYear,
        mileage: 82000,
        notes: "Annual vehicle licensing (mock extraction)",
        confidence: 0.6,
      },
      {
        document_category: "inspection",
        start_date: today,
        end_date: inAYear,
        mileage: 82000,
        cost: 150,
        notes: "Annual roadworthiness test (mock extraction)",
        confidence: 0.6,
      },
    ] as const;

    const idx = input.imageBase64.length % samples.length;
    // Parsed through the same schema as the real provider so the shape can
    // never drift.
    return parseScanExtraction(samples[idx]);
  }
}

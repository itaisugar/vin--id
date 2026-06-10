import "server-only";

import type {
  DocumentExtractionInput,
  DocumentExtractionProvider,
} from "@/lib/documents/scan/provider";
import { scanExtractionSchema, type ScanExtraction } from "@/lib/documents/scan/types";

/**
 * MOCK scanned-document extraction provider — deterministic, NO real AI/OCR, NO
 * network, NO API key. It returns the SAME structured schema the real provider
 * uses so swapping is isolated. This is the default unless MOCK_AI=false AND an
 * API key is set.
 *
 * IMPORTANT: this is NOT real extraction. The values are a fixed demo sample
 * (clearly labelled "mock" in the UI) and are never auto-saved — the user must
 * review and confirm a pre-filled, editable record.
 */
export class MockExtractionProvider implements DocumentExtractionProvider {
  readonly engine = "mock" as const;

  async extract(_input: DocumentExtractionInput): Promise<ScanExtraction> {
    void _input;
    // Deterministic demo result. Parsed through the same schema as the real
    // provider so the shape can never drift.
    return scanExtractionSchema.parse({
      date: new Date().toISOString().slice(0, 10),
      service_or_work_description: "Oil and filter change (mock extraction)",
      mileage: null,
      cost: 450,
      vendor: "Mock Garage",
      document_type_guess: "maintenance",
      confidence: 0.6,
    });
  }
}

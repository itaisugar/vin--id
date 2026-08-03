import "server-only";

import type { ScanExtraction, ScanImageMime } from "./types";
import { MockExtractionProvider } from "@/lib/server/ai/mock-document-scan";
import { AnthropicExtractionProvider } from "@/lib/server/ai/anthropic-document-scan";
import {
  ExtractionUnavailableError,
  resolveExtractionProviderMode,
} from "@/lib/server/ai/provider-mode";

/**
 * Provider abstraction for scanned-document extraction. The swap point between
 * the deterministic mock and a real model lives here — callers depend only on
 * the interface.
 */

export interface DocumentExtractionInput {
  /** Already-downscaled image as base64 (no `data:` prefix). */
  imageBase64: string;
  mediaType: ScanImageMime;
  /** UI locale, passed to the model as a hint (does not change the schema). */
  locale?: string;
}

export interface DocumentExtractionProvider {
  readonly engine: "mock" | "anthropic";
  /**
   * Extract structured fields from a document image. Implementations must never
   * invent values (null for anything not present) and must never throw for a
   * "no fields found" result — only for genuine provider/transport failures.
   */
  extract(input: DocumentExtractionInput): Promise<ScanExtraction>;
}

/**
 * Select the active provider through the shared production-safety gate
 * (`resolveExtractionProviderMode`). The real Anthropic provider is used
 * whenever a key is configured; the deterministic mock is used in test/dev as a
 * zero-config fallback. In PRODUCTION a missing key (or an explicit `mock`
 * selection) throws `ExtractionUnavailableError` instead of silently mocking —
 * every caller already treats a thrown extraction as "unavailable → manual".
 */
export function getExtractionProvider(): DocumentExtractionProvider {
  const mode = resolveExtractionProviderMode();
  if (mode.engine === "unavailable") throw new ExtractionUnavailableError(mode.reason);
  return mode.engine === "anthropic"
    ? new AnthropicExtractionProvider()
    : new MockExtractionProvider();
}

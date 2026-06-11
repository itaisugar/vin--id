import "server-only";

import type { ScanExtraction, ScanImageMime } from "./types";
import { MockExtractionProvider } from "@/lib/server/ai/mock-document-scan";
import { AnthropicExtractionProvider } from "@/lib/server/ai/anthropic-document-scan";

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
 * Select the active provider. The real Anthropic provider is used whenever an
 * ANTHROPIC_API_KEY is configured; otherwise we fall back to the deterministic
 * mock (so the app still works with no key). The MOCK_AI flag no longer gates
 * this — extraction is "real whenever a key is present" per owner decision.
 */
export function getExtractionProvider(): DocumentExtractionProvider {
  const hasKey = Boolean(process.env.ANTHROPIC_API_KEY);
  return hasKey
    ? new AnthropicExtractionProvider()
    : new MockExtractionProvider();
}

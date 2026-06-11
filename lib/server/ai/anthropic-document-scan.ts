import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import type {
  DocumentExtractionInput,
  DocumentExtractionProvider,
} from "@/lib/documents/scan/provider";
import {
  coerceCategory,
  scanExtractionSchema,
  type ScanExtraction,
} from "@/lib/documents/scan/types";

/**
 * Real document extraction via the Anthropic Messages API (server-side only).
 * The API key NEVER reaches the client — this module is `server-only` and is
 * only constructed from a server action.
 *
 * Output contract: the model returns ONLY a JSON object. We strip any stray
 * code fences, JSON.parse, then validate with Zod. Any failure throws
 * ExtractionProviderError so the caller can fall back to manual entry.
 */

export class ExtractionProviderError extends Error {
  constructor(message = "extraction_failed") {
    super(message);
    this.name = "ExtractionProviderError";
  }
}

const DEFAULT_MODEL = "claude-haiku-4-5-20251001";

// Static instruction block — kept byte-stable and marked cacheable so repeated
// calls can reuse the prefix (prompt caching). Volatile content (the image and
// the locale hint) goes after it.
const INSTRUCTION = `You read a photo of a vehicle-related document. Work in two steps:
STEP 1 — CLASSIFY the document into exactly one "document_category":
  - "maintenance"   : a service/repair receipt or invoice from a garage.
  - "insurance"     : a vehicle insurance policy / certificate.
  - "registration"  : a vehicle licensing / registration document.
  - "inspection"    : a vehicle roadworthiness test / inspection report.
  - "unknown"       : you cannot confidently tell.
STEP 2 — EXTRACT ONLY that category's fields.

Return ONLY a single JSON object. No prose, no explanation, no markdown, no code
fences. Include "document_category", "confidence" (0..1), and ONLY the fields for
the chosen category (omit the others):

maintenance:
  { "document_category": "maintenance", "date": string|null, "garage_name": string|null,
    "mileage": number|null, "service_type": string|null, "service_details": string|null,
    "confidence": number }
insurance:
  { "document_category": "insurance", "insurer_name": string|null, "start_date": string|null,
    "end_date": string|null, "cost": number|null, "insurance_type": string|null,
    "confidence": number }
registration:
  { "document_category": "registration", "start_date": string|null, "end_date": string|null,
    "mileage": number|null, "notes": string|null, "confidence": number }
inspection:
  { "document_category": "inspection", "start_date": string|null, "end_date": string|null,
    "mileage": number|null, "cost": number|null, "notes": string|null, "confidence": number }
unknown:
  { "document_category": "unknown", "confidence": number }

Rules:
- Never invent values. Use null for any field not clearly present in the image.
- Dates as ISO yyyy-mm-dd. Numbers as plain numbers (no currency symbols or units).
- For a validity range, "start_date" is when the document/cover begins (issue or
  "valid from") and "end_date" is when it ends or expires ("valid until"). A
  "valid until" / expiry date is ALWAYS the end_date. "end_date" must be on or
  after "start_date" — never output a range whose end precedes its start.
- Output the JSON object only.`;

/** Remove ```json fences / stray prose around a JSON object. */
function extractJsonObject(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = (fenced ? fenced[1] : text).trim();
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) return body;
  return body.slice(start, end + 1);
}

export class AnthropicExtractionProvider implements DocumentExtractionProvider {
  readonly engine = "anthropic" as const;

  async extract(input: DocumentExtractionInput): Promise<ScanExtraction> {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new ExtractionProviderError();

    const model = process.env.EXTRACTION_MODEL || DEFAULT_MODEL;
    const client = new Anthropic({ apiKey, timeout: 30_000, maxRetries: 1 });

    let text: string;
    try {
      const response = await client.messages.create({
        model,
        max_tokens: 1024,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: INSTRUCTION,
                cache_control: { type: "ephemeral" },
              },
              {
                type: "image",
                source: {
                  type: "base64",
                  media_type: input.mediaType,
                  data: input.imageBase64,
                },
              },
              {
                type: "text",
                text:
                  input.locale === "he"
                    ? "The document may be in Hebrew. Return the JSON object now."
                    : "Return the JSON object now.",
              },
            ],
          },
        ],
      });

      text = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("")
        .trim();
    } catch (err) {
      // Transport / API / timeout error — surface as a provider failure.
      throw new ExtractionProviderError(
        err instanceof Error ? err.message : "extraction_failed",
      );
    }

    if (!text) throw new ExtractionProviderError();

    let parsed: unknown;
    try {
      parsed = JSON.parse(extractJsonObject(text));
    } catch {
      throw new ExtractionProviderError("invalid_json");
    }

    // Coerce an unexpected/missing category to "unknown" so a surprising
    // classifier value degrades to manual entry instead of failing the parse.
    const result = scanExtractionSchema.safeParse(coerceCategory(parsed));
    if (!result.success) throw new ExtractionProviderError("invalid_json");
    return result.data;
  }
}

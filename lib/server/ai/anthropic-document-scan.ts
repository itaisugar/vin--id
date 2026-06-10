import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import type {
  DocumentExtractionInput,
  DocumentExtractionProvider,
} from "@/lib/documents/scan/provider";
import { scanExtractionSchema, type ScanExtraction } from "@/lib/documents/scan/types";

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
const INSTRUCTION = `You extract structured data from a photo of a vehicle-related document — typically a maintenance/service receipt or invoice, or a note describing a vehicle problem.

Return ONLY a single JSON object. No prose, no explanation, no markdown, no code fences. The object must have exactly these keys:
{
  "date": string|null,                          // service/document date as ISO yyyy-mm-dd
  "service_or_work_description": string|null,   // short description of the work done or the problem
  "mileage": number|null,                       // odometer reading, plain number, if present
  "cost": number|null,                          // total amount, plain number, if present
  "vendor": string|null,                        // garage / shop / issuer name
  "document_type_guess": "maintenance" | "issue" | "unknown",
  "confidence": number                          // overall confidence from 0 to 1
}

Rules:
- Never invent values. Use null for anything not clearly present in the image.
- Use "maintenance" for receipts, invoices, and service/repair records.
- Use "issue" for fault, problem, or complaint reports.
- Use "unknown" if you cannot tell.
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

    const result = scanExtractionSchema.safeParse(parsed);
    if (!result.success) throw new ExtractionProviderError("invalid_json");
    return result.data;
  }
}

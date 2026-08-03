import "server-only";

import { buildVehicleRegistrationPrompt } from "./prompt";
import {
  parseVehicleRegistrationExtraction,
  type VehicleRegistrationExtraction,
} from "./extraction-types";
import type { ScanImageMime } from "@/lib/documents/scan/types";
import {
  ExtractionUnavailableError,
  resolveExtractionProviderMode,
} from "@/lib/server/ai/provider-mode";

/**
 * Vehicle-registration extraction provider.
 *
 * Reuses the EXISTING AI infrastructure choice: the real Anthropic model when a
 * key is configured, else a deterministic mock (so the app and tests run with no
 * key). This is the same "real whenever a key is present" gate the scan flow
 * uses — not a second AI platform. All output goes through
 * `parseVehicleRegistrationExtraction`, which allowlists fields and strips PII.
 */

export class VehicleExtractionError extends Error {
  readonly reason: "no_key" | "provider_error" | "invalid_json" | "unreadable";
  constructor(reason: VehicleExtractionError["reason"], message?: string) {
    super(message ?? reason);
    this.name = "VehicleExtractionError";
    this.reason = reason;
  }
}

export interface VehicleExtractionInput {
  imageBase64: string;
  mediaType: ScanImageMime;
  locale?: string;
}

export interface VehicleExtractionProvider {
  readonly engine: "mock" | "anthropic";
  readonly model: string;
  extract(input: VehicleExtractionInput): Promise<VehicleRegistrationExtraction>;
}

const DEFAULT_MODEL = "claude-haiku-4-5-20251001";

function extractJsonObject(body: string): string {
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) return body;
  return body.slice(start, end + 1);
}

/**
 * Turn a model's raw text into a validated extraction, or throw. Factored out so
 * the "malformed response never becomes mock output" rule is unit-testable
 * without a live provider. Throws `VehicleExtractionError`, never returns mock.
 */
export function parseVehicleModelResponse(text: string): VehicleRegistrationExtraction {
  const trimmed = text.trim();
  if (!trimmed) throw new VehicleExtractionError("unreadable");
  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJsonObject(trimmed));
  } catch {
    throw new VehicleExtractionError("invalid_json");
  }
  if (!parsed || typeof parsed !== "object") throw new VehicleExtractionError("invalid_json");
  return parseVehicleRegistrationExtraction(parsed);
}

/** Minimal shape of the Anthropic client used here — injectable for tests. */
export interface AnthropicMessagesClient {
  messages: {
    create(args: unknown): Promise<{ content: Array<{ type: string; text?: string }> }>;
  };
}

/**
 * Deterministic mock: returns a recognizable vehicle-registration result so the
 * flow and tests work with no provider key. It NEVER echoes real document data
 * because there is none — it produces a fixed sample.
 */
export class MockVehicleExtractionProvider implements VehicleExtractionProvider {
  readonly engine = "mock" as const;
  readonly model = "mock";
  async extract(): Promise<VehicleRegistrationExtraction> {
    return parseVehicleRegistrationExtraction({
      document_type: "vehicle_registration",
      document_type_confidence: 0.9,
      registration_number: { value: "12345678", confidence: 0.9 },
      make: { value: "טויוטה", confidence: 0.8 },
      model: { value: "COROLLA", confidence: 0.7 },
      year: { value: 2019, confidence: 0.85 },
      vin: { value: "MOCKVIN0000000000", confidence: 0.6 },
      color: { value: "לבן", confidence: 0.8 },
      fuel_type: { value: "בנזין", confidence: 0.8 },
      test_expiry_date: { value: "2027-03-01", confidence: 0.7 },
      warnings: [],
    });
  }
}

export class AnthropicVehicleExtractionProvider implements VehicleExtractionProvider {
  readonly engine = "anthropic" as const;
  readonly model: string;
  /** Optional injected client (tests); production lazy-loads the SDK. */
  private readonly injectedClient?: AnthropicMessagesClient;
  constructor(injectedClient?: AnthropicMessagesClient) {
    this.injectedClient = injectedClient;
    this.model = process.env.EXTRACTION_MODEL || DEFAULT_MODEL;
  }

  private async client(): Promise<AnthropicMessagesClient> {
    if (this.injectedClient) return this.injectedClient;
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new VehicleExtractionError("no_key");
    // Lazy import so a mock-only deployment never loads the SDK.
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    return new Anthropic({ apiKey, timeout: 30_000, maxRetries: 1 });
  }

  async extract(input: VehicleExtractionInput): Promise<VehicleRegistrationExtraction> {
    const client = await this.client();

    let text: string;
    try {
      const response = await client.messages.create({
        model: this.model,
        max_tokens: 1024,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: buildVehicleRegistrationPrompt(input.locale), cache_control: { type: "ephemeral" } },
              { type: "image", source: { type: "base64", media_type: input.mediaType, data: input.imageBase64 } },
              { type: "text", text: "Return the JSON object now." },
            ],
          },
        ],
      });
      // A provider timeout / 5xx rejects the promise above and is caught below —
      // it NEVER produces mock output.
      text = response.content
        .filter((b) => b.type === "text")
        .map((b) => b.text ?? "")
        .join("")
        .trim();
    } catch (err) {
      if (err instanceof VehicleExtractionError) throw err;
      throw new VehicleExtractionError("provider_error", err instanceof Error ? err.message : undefined);
    }

    // Malformed / empty response → a typed failure, never a fabricated result.
    return parseVehicleModelResponse(text);
  }
}

/**
 * Select the vehicle-registration extraction provider through the shared
 * production-safety gate. In production a missing key or an explicit `mock`
 * selection throws `ExtractionUnavailableError` instead of silently mocking.
 */
export function getVehicleExtractionProvider(
  env: Record<string, string | undefined> = process.env,
): VehicleExtractionProvider {
  const mode = resolveExtractionProviderMode(env);
  if (mode.engine === "unavailable") throw new ExtractionUnavailableError(mode.reason);
  return mode.engine === "anthropic"
    ? new AnthropicVehicleExtractionProvider()
    : new MockVehicleExtractionProvider();
}

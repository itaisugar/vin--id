/**
 * Extraction-provider selection — the single production-safety gate.
 *
 * Release rule (Task F, Phase 2): the PRODUCTION application must never silently
 * select the Mock AI provider. A silent mock in production would fabricate
 * "extracted" data and could create records from synthetic values. So provider
 * choice is resolved here, once, from the environment:
 *
 *   - production: real provider only. A missing key or an explicit `mock`
 *     selection resolves to `unavailable` (an explicit configuration-error
 *     state the caller surfaces) — NEVER to a mock.
 *   - test / development: the deterministic mock is allowed, either explicitly
 *     (`AI_EXTRACTION_PROVIDER=mock`) or as the zero-config no-key fallback the
 *     project relies on for local work and CI.
 *
 * There is deliberately no branch that falls back from `anthropic` to `mock`.
 * A provider timeout, 5xx, or malformed response is handled at the call site as
 * a failure — it must not switch to mock output.
 *
 * This is a pure function (env is injectable) so every rule is unit-tested.
 */

export type ExtractionProviderMode =
  | { engine: "anthropic" }
  | { engine: "mock" }
  | { engine: "unavailable"; reason: "missing_key" | "mock_in_production" };

/** Thrown by a provider factory when no provider may be used (config error). */
export class ExtractionUnavailableError extends Error {
  readonly reason: "missing_key" | "mock_in_production";
  constructor(reason: ExtractionUnavailableError["reason"]) {
    super(`extraction provider unavailable: ${reason}`);
    this.name = "ExtractionUnavailableError";
    this.reason = reason;
  }
}

export function resolveExtractionProviderMode(
  env: Record<string, string | undefined> = process.env,
): ExtractionProviderMode {
  const isProduction = env.NODE_ENV === "production";
  const selector = (env.AI_EXTRACTION_PROVIDER ?? "").trim().toLowerCase();
  const hasKey = Boolean(env.ANTHROPIC_API_KEY && env.ANTHROPIC_API_KEY.trim());

  // An explicit selector always wins over the legacy key-based default.
  if (selector === "mock") {
    // Mock is only ever permitted outside production.
    return isProduction
      ? { engine: "unavailable", reason: "mock_in_production" }
      : { engine: "mock" };
  }
  if (selector === "anthropic") {
    // Requesting the real provider without a key is a configuration error, in
    // every environment — it must not silently degrade to mock.
    return hasKey ? { engine: "anthropic" } : { engine: "unavailable", reason: "missing_key" };
  }

  // No (or unrecognized) selector → legacy "real whenever a key is present"
  // gate, made production-safe.
  if (isProduction) {
    return hasKey ? { engine: "anthropic" } : { engine: "unavailable", reason: "missing_key" };
  }
  // Test / development: real when a key is present, else the deterministic mock.
  return hasKey ? { engine: "anthropic" } : { engine: "mock" };
}

#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-unused-expressions --
   Deliberate `cond ? P(msg) : F(msg)` assertion style; both branches log+tally. */
/**
 * AI extraction provider production-hardening — validation (OFFLINE, no network).
 *
 * Proves the release rule (Task F, Phase 2): the PRODUCTION app never silently
 * selects the Mock AI provider, and a provider failure (timeout / 5xx /
 * malformed) never degrades to mock output.
 *
 * Runs through the `@/` + server-only resolve hook so it can import the
 * server-only provider modules directly.
 */

import {
  resolveExtractionProviderMode,
  ExtractionUnavailableError,
} from "../../lib/server/ai/provider-mode.ts";
import {
  getVehicleExtractionProvider,
  AnthropicVehicleExtractionProvider,
  MockVehicleExtractionProvider,
  VehicleExtractionError,
  parseVehicleModelResponse,
} from "../../lib/vehicle-intake/provider.ts";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve as resolvePath } from "node:path";

let fails = 0, passes = 0;
const P = (m) => { passes++; console.log(`  PASS  ${m}`); };
const F = (m) => { fails++; console.error(`  FAIL  ${m}`); };
const section = (t) => console.log(`\n— ${t} —`);

const REPO = resolvePath(dirname(fileURLToPath(import.meta.url)), "../..");

async function main() {
  section("1. resolveExtractionProviderMode — production safety");
  {
    // 1: production + missing key -> unavailable(missing_key), NOT mock
    const m = resolveExtractionProviderMode({ NODE_ENV: "production" });
    m.engine === "unavailable" && m.reason === "missing_key"
      ? P("production + missing key -> unavailable(missing_key), never mock") : F(`prod no key -> ${JSON.stringify(m)}`);
  }
  {
    // 2: production + explicit mock -> rejected (unavailable)
    const m = resolveExtractionProviderMode({ NODE_ENV: "production", AI_EXTRACTION_PROVIDER: "mock", ANTHROPIC_API_KEY: "sk-x" });
    m.engine === "unavailable" && m.reason === "mock_in_production"
      ? P("production + explicit mock -> rejected (mock_in_production)") : F(`prod mock -> ${JSON.stringify(m)}`);
  }
  {
    // production + anthropic + key -> anthropic
    const m = resolveExtractionProviderMode({ NODE_ENV: "production", AI_EXTRACTION_PROVIDER: "anthropic", ANTHROPIC_API_KEY: "sk-x" });
    m.engine === "anthropic" ? P("production + anthropic + key -> anthropic") : F(`prod anthropic -> ${JSON.stringify(m)}`);
  }
  {
    // production + key, no selector -> anthropic (legacy default, production-safe)
    const m = resolveExtractionProviderMode({ NODE_ENV: "production", ANTHROPIC_API_KEY: "sk-x" });
    m.engine === "anthropic" ? P("production + key (no selector) -> anthropic") : F(`prod key -> ${JSON.stringify(m)}`);
  }

  section("2. resolveExtractionProviderMode — test / development");
  {
    // 3: test + explicit mock -> mock
    const m = resolveExtractionProviderMode({ NODE_ENV: "test", AI_EXTRACTION_PROVIDER: "mock" });
    m.engine === "mock" ? P("test + explicit mock -> mock") : F(`test mock -> ${JSON.stringify(m)}`);
  }
  {
    // 4: development + explicit mock -> mock
    const m = resolveExtractionProviderMode({ NODE_ENV: "development", AI_EXTRACTION_PROVIDER: "mock" });
    m.engine === "mock" ? P("development + explicit mock -> mock") : F(`dev mock -> ${JSON.stringify(m)}`);
  }
  {
    // dev/undefined, no key, no selector -> mock (zero-config CI/local fallback preserved)
    const m = resolveExtractionProviderMode({});
    m.engine === "mock" ? P("no NODE_ENV, no key -> mock (CI/local fallback preserved)") : F(`empty env -> ${JSON.stringify(m)}`);
  }
  {
    // anthropic selector without key -> unavailable in EVERY env (no silent mock)
    const m = resolveExtractionProviderMode({ NODE_ENV: "development", AI_EXTRACTION_PROVIDER: "anthropic" });
    m.engine === "unavailable" && m.reason === "missing_key"
      ? P("anthropic selector without key -> unavailable (no degrade to mock)") : F(`dev anthropic no key -> ${JSON.stringify(m)}`);
  }

  section("3. Factory honors the gate");
  {
    // production + no key -> factory throws, does NOT return a Mock instance
    let threw = null, inst = null;
    try { inst = getVehicleExtractionProvider({ NODE_ENV: "production" }); }
    catch (e) { threw = e; }
    threw instanceof ExtractionUnavailableError && threw.reason === "missing_key"
      ? P("getVehicleExtractionProvider(prod,no key) throws ExtractionUnavailableError") : F(`factory prod no key -> ${inst?.engine ?? threw}`);
    !(inst instanceof MockVehicleExtractionProvider) ? P("factory returned no Mock in production") : F("factory returned Mock in production");
  }
  {
    // production + explicit mock -> throws (rejected)
    let threw = null;
    try { getVehicleExtractionProvider({ NODE_ENV: "production", AI_EXTRACTION_PROVIDER: "mock" }); }
    catch (e) { threw = e; }
    threw instanceof ExtractionUnavailableError && threw.reason === "mock_in_production"
      ? P("factory rejects explicit mock in production") : F(`factory prod mock -> ${threw}`);
  }
  {
    // dev/no key -> Mock (unchanged local/CI behavior)
    const inst = getVehicleExtractionProvider({});
    inst instanceof MockVehicleExtractionProvider ? P("factory returns Mock for no-key dev/CI") : F("factory dev mock");
  }

  section("4. Anthropic failures never become mock output");
  const okBody = JSON.stringify({
    document_type: "vehicle_registration", document_type_confidence: 0.9,
    registration_number: { value: "87654321", confidence: 0.9 },
    make: { value: "Mazda", confidence: 0.8 },
  });
  const fakeClient = (behavior) => ({
    messages: { create: async () => {
      if (behavior === "throw") { const e = new Error("Request timed out"); e.name = "APIConnectionTimeoutError"; throw e; }
      if (behavior === "5xx") { const e = new Error("overloaded"); e.status = 529; throw e; }
      if (behavior === "malformed") return { content: [{ type: "text", text: "sorry, I can't do that" }] };
      if (behavior === "empty") return { content: [] };
      return { content: [{ type: "text", text: okBody }] };
    } },
  });
  {
    const p = new AnthropicVehicleExtractionProvider(fakeClient("throw"));
    let threw = null, res = null;
    try { res = await p.extract({ imageBase64: "x", mediaType: "image/jpeg" }); } catch (e) { threw = e; }
    threw instanceof VehicleExtractionError && threw.reason === "provider_error"
      ? P("timeout -> VehicleExtractionError(provider_error), not mock") : F(`timeout -> ${res ? JSON.stringify(res) : threw}`);
    res === null ? P("timeout produced no extraction result") : F("timeout produced a result");
  }
  {
    const p = new AnthropicVehicleExtractionProvider(fakeClient("5xx"));
    let threw = null;
    try { await p.extract({ imageBase64: "x", mediaType: "image/jpeg" }); } catch (e) { threw = e; }
    threw instanceof VehicleExtractionError ? P("5xx -> VehicleExtractionError, not mock") : F(`5xx -> ${threw}`);
  }
  {
    const p = new AnthropicVehicleExtractionProvider(fakeClient("malformed"));
    let threw = null;
    try { await p.extract({ imageBase64: "x", mediaType: "image/jpeg" }); } catch (e) { threw = e; }
    threw instanceof VehicleExtractionError && threw.reason === "invalid_json"
      ? P("malformed response -> invalid_json, not mock") : F(`malformed -> ${threw}`);
  }
  {
    const p = new AnthropicVehicleExtractionProvider(fakeClient("empty"));
    let threw = null;
    try { await p.extract({ imageBase64: "x", mediaType: "image/jpeg" }); } catch (e) { threw = e; }
    threw instanceof VehicleExtractionError && threw.reason === "unreadable"
      ? P("empty response -> unreadable, not mock") : F(`empty -> ${threw}`);
  }
  {
    // Happy path (injected) proves the provider returns real parsed output, no mock fallback path exists.
    const p = new AnthropicVehicleExtractionProvider(fakeClient("ok"));
    const res = await p.extract({ imageBase64: "x", mediaType: "image/jpeg" });
    res.registration_number.value === "87654321" && res.make.value === "Mazda"
      ? P("valid response parsed to the model's values (not the mock sample)") : F(`ok -> ${JSON.stringify(res)}`);
  }

  section("5. parseVehicleModelResponse (pure)");
  {
    let threw = null;
    try { parseVehicleModelResponse(""); } catch (e) { threw = e; }
    threw instanceof VehicleExtractionError && threw.reason === "unreadable" ? P("empty text -> unreadable") : F("empty text");
  }
  {
    let threw = null;
    try { parseVehicleModelResponse("not json at all"); } catch (e) { threw = e; }
    threw instanceof VehicleExtractionError && threw.reason === "invalid_json" ? P("non-JSON -> invalid_json") : F("non-json");
  }
  {
    const ex = parseVehicleModelResponse(`prefix ${okBody} suffix`);
    ex.registration_number.value === "87654321" ? P("JSON embedded in prose parsed") : F("embedded json");
  }

  section("6. No upload / DB write on a configuration failure (structural)");
  {
    // The service must return `extractUnavailable` BEFORE any storage upload or
    // document_extractions insert — proven by source ordering.
    const src = readFileSync(resolvePath(REPO, "lib/vehicle-intake/service.ts"), "utf8");
    const iUnavailable = src.indexOf('error: "extractUnavailable"');
    const iUpload = src.indexOf(".upload(");
    const iInsert = src.indexOf('.from("document_extractions")');
    iUnavailable > -1 && iUnavailable < iUpload && iUnavailable < iInsert
      ? P("extractUnavailable returns before storage upload and DB insert") : F(`ordering unavailable=${iUnavailable} upload=${iUpload} insert=${iInsert}`);
  }
  {
    // The unavailable branch maps the provider-mode error, not a mock.
    const src = readFileSync(resolvePath(REPO, "lib/vehicle-intake/service.ts"), "utf8");
    src.includes("ExtractionUnavailableError") && !src.includes("MockVehicleExtractionProvider")
      ? P("service surfaces ExtractionUnavailableError and never constructs a Mock") : F("service mock reference");
  }
  {
    // Provider keys are server-only — never NEXT_PUBLIC.
    const src = readFileSync(resolvePath(REPO, "lib/server/ai/provider-mode.ts"), "utf8");
    !src.includes("NEXT_PUBLIC") ? P("provider-mode reads no NEXT_PUBLIC config") : F("NEXT_PUBLIC leak");
  }

  console.log(`\n${fails === 0 ? "OK" : "FAILED"} — ${passes} passed, ${fails} failed`);
  process.exit(fails === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });

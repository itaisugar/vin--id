#!/usr/bin/env node
/**
 * Offline tests for the government-vehicle-data research spike.
 *
 * NO NETWORK. `fetch` is mocked; fixtures are read from disk. This proves the
 * adapter's pure logic (normalization, mapping, date parsing, result
 * classification) and its failure handling (timeout, 5xx, malformed) without
 * calling the live API — live calls are opt-in via the script's --live flag and
 * are deliberately excluded from any CI path.
 *
 * Run: node scripts/research/government-vehicle-data-spike.test.mjs
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  normalizeRegistrationNumber,
  parseGovDate,
  mapRecord,
  interpretResponse,
  lookup,
} from "./government-vehicle-data-spike.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const fx = (n) => JSON.parse(readFileSync(resolve(here, "fixtures", n), "utf8"));

let pass = 0, fail = 0;
const ok = (c, m) => (c ? (pass++, console.log(`  PASS  ${m}`)) : (fail++, console.error(`  FAIL  ${m}`)));
const section = (t) => console.log(`\n— ${t} —`);

// A mock fetch factory: returns a Response-like object, or throws to simulate
// network/timeout, driven by the scenario passed in.
function mockFetch(scenario) {
  return async () => {
    if (scenario.abort) {
      const e = new Error("aborted");
      e.name = "AbortError";
      throw e;
    }
    if (scenario.networkError) throw new Error("ECONNRESET");
    return {
      ok: scenario.httpStatus ? scenario.httpStatus < 400 : true,
      status: scenario.httpStatus ?? 200,
      json: async () => {
        if (scenario.invalidJson) throw new Error("Unexpected token");
        return scenario.body;
      },
    };
  };
}

async function main() {
  section("normalizeRegistrationNumber");
  ok(normalizeRegistrationNumber("12345678").query === "12345678", "8-digit number normalizes");
  ok(normalizeRegistrationNumber("123-45-678").query === "12345678", "hyphens are stripped");
  ok(normalizeRegistrationNumber("  12 345 678 ").query === "12345678", "spaces are stripped");
  ok(normalizeRegistrationNumber("0012345").query === "12345", "leading zeros dropped for the numeric query");
  ok(normalizeRegistrationNumber("0012345").digits === "0012345", "original digit string preserved for display");
  ok(normalizeRegistrationNumber("12A45").ok === false, "letters rejected (non_numeric)");
  ok(normalizeRegistrationNumber("1234").ok === false, "too-short rejected (out_of_range)");
  ok(normalizeRegistrationNumber("123456789").ok === false, "too-long rejected (out_of_range)");
  ok(normalizeRegistrationNumber("").ok === false, "empty rejected");
  ok(normalizeRegistrationNumber("   ").ok === false, "whitespace-only rejected");

  section("parseGovDate");
  ok(parseGovDate("2027-08-27").iso === "2027-08-27", "full ISO date parsed");
  ok(parseGovDate("2011-8").partial === true && parseGovDate("2011-8").month === 8, "YYYY-M treated as month-precision, not a day");
  ok(parseGovDate(null).valid === false, "null date -> invalid");
  ok(parseGovDate("not-a-date").valid === false, "garbage date -> invalid");
  ok(parseGovDate("2027-13-40").valid === false, "impossible ISO date -> invalid");

  section("mapRecord (found private)");
  {
    const rec = fx("government-vehicle-found-private.json").result.records[0];
    const d = mapRecord(rec);
    ok(d.make === "טויוטה יפן", "make from tozeret_nm");
    ok(d.model === "COROLLA", "model prefers commercial name (kinuy_mishari)");
    ok(d.year === 2011, "year from shnat_yitzur");
    ok(d.color === "אפור כהה מטלי", "color from tzeva_rechev");
    ok(d.fuel_type === "בנזין", "fuel from sug_delek_nm");
    ok(d.test_expiry_date === "2027-08-27", "test expiry from tokef_dt");
    ok(d._display.last_test_date === "2026-07-13", "last test date is display-only");
    ok(d._display.ownership_type === "פרטי", "ownership TYPE captured as display, not identity");
    ok(d.warnings.includes("registration_number_had_leading_zero"), "leading-zero plate warned");
    ok(d.warnings.includes("first_road_date_is_month_precision"), "month-precision first-road date warned");
    // No owner identity fields exist anywhere in the mapped output.
    ok(!("owner_name" in d) && !("owner_id" in d) && !("address" in d), "no owner identity in the draft");
  }

  section("mapRecord (personal import — different chassis field)");
  {
    const rec = fx("government-vehicle-personal-import.json").result.records[0];
    const d = mapRecord(rec);
    ok(d.vin === "MASKED-CHASSIS-9999", "chassis read from `shilda` when `misgeret` is absent");
    ok(d.model === "MODEL 3", "coded model used when no commercial name");
    ok(d.warnings.includes("model_is_coded_degem_nm"), "coded-model warning emitted");
    ok(d._display.import_type === "יבוא אישי", "import type captured for display");
  }

  section("interpretResponse");
  ok(interpretResponse(fx("government-vehicle-found-private.json")).status === "found", "found fixture -> found");
  ok(interpretResponse(fx("government-vehicle-not-found.json")).status === "not_found", "empty fixture -> not_found");
  ok(interpretResponse(fx("government-vehicle-malformed.json")).status === "unavailable", "malformed records -> unavailable");
  {
    // Duplicate provider result: two records for one exact filter.
    const dup = fx("government-vehicle-found-private.json");
    dup.result.records = [dup.result.records[0], { ...dup.result.records[0], _id: 2 }];
    const r = interpretResponse(dup);
    ok(r.status === "found" && r.vehicle.warnings.includes("multiple_records_returned"), "duplicate result -> found + warning");
  }

  section("lookup (mocked transport)");
  ok((await lookup("12A45", {})).status === "invalid_registration_number", "invalid input short-circuits before any request");
  {
    const r = await lookup("12345678", { fetchImpl: mockFetch({ body: fx("government-vehicle-found-private.json") }) });
    ok(r.status === "found" && r.source === "israel_government" && r.fetchedAt, "found result carries source + fetchedAt");
  }
  ok((await lookup("12345678", { fetchImpl: mockFetch({ body: fx("government-vehicle-not-found.json") }) })).status === "not_found", "zero results -> not_found");
  {
    const r = await lookup("12345678", { fetchImpl: mockFetch({ httpStatus: 503 }) });
    ok(r.status === "unavailable" && r.retryable === true, "5xx -> unavailable + retryable");
  }
  {
    const r = await lookup("12345678", { fetchImpl: mockFetch({ httpStatus: 400 }) });
    ok(r.status === "unavailable" && r.retryable === false, "4xx -> unavailable + not retryable");
  }
  {
    const r = await lookup("12345678", { fetchImpl: mockFetch({ invalidJson: true }) });
    ok(r.status === "unavailable" && r.reason === "invalid_json", "malformed JSON -> unavailable");
  }
  {
    const r = await lookup("12345678", { fetchImpl: mockFetch({ abort: true }) });
    ok(r.status === "unavailable" && r.reason === "timeout", "timeout -> unavailable(timeout)");
  }
  {
    const r = await lookup("12345678", { fetchImpl: mockFetch({ networkError: true }) });
    ok(r.status === "unavailable" && r.reason === "network_error", "network error -> unavailable(network_error)");
  }

  console.log(`\n${fail === 0 ? "OK" : "FAILED"} — ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });

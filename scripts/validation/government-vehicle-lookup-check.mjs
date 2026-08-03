#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-unused-expressions --
   Deliberate `cond ? P(msg) : F(msg)` assertion style; both branches log+tally. */
/**
 * Government vehicle lookup — validation.
 *
 * OFFLINE by default: normalization, the record→draft mapper, the provider
 * transport (mocked fetch — never the live API), and the service orchestration
 * (mock fetch + injected config, so no env and no network). A small DB section
 * (guarded) proves the additive migration: new columns, the data_source CHECK,
 * and organization-scoped storage.
 *
 * The live provider is exercised ONLY by the opt-in live command
 * (validate:government-vehicle-live). CI never calls data.gov.il.
 *
 * Guards for the DB section: FLEET_CHECK_ALLOW=1, refuse prod ref / non-local.
 */

import { createClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { normalizeRegistration, registrationDuplicateKey, toNumericFilterValue }
  from "../../lib/vehicle-lookup/normalize-registration.ts";
import { mapGovernmentVehicle, parseFullIsoDate }
  from "../../lib/vehicle-lookup/map-government-vehicle.ts";
import { queryGovernmentVehicle } from "../../lib/vehicle-lookup/israel-government-provider.ts";
import { lookupVehicle, _clearLookupCache } from "../../lib/vehicle-lookup/service.ts";

let fails = 0, passes = 0;
const P = (m) => { passes++; console.log(`  PASS  ${m}`); };
const F = (m) => { fails++; console.error(`  FAIL  ${m}`); };
const section = (t) => console.log(`\n— ${t} —`);

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../..");
const read = (p) => readFileSync(resolve(repo, p), "utf8");

const CONFIG = {
  baseUrl: "https://data.gov.il/api/3/action/",
  resourceId: "053cea08-09bc-40ec-8f7a-156f0677aff3",
  timeoutMs: 8000,
  cacheTtlMs: 30 * 60 * 1000,
  notFoundCacheTtlMs: 5 * 60 * 1000,
};

const FOUND_RECORD = {
  mispar_rechev: "0000074",
  tozeret_nm: "טויוטה יפן",
  kinuy_mishari: "COROLLA",
  degem_nm: "ZRE151L-AEPDKW",
  shnat_yitzur: 2011,
  tzeva_rechev: "אפור כהה מטלי",
  sug_delek_nm: "בנזין",
  misgeret: "CHASSIS-X",
  tokef_dt: "2027-08-27",
  mivchan_acharon_dt: "2026-07-13",
  baalut: "פרטי",
};

function envelope(records) {
  return { success: true, result: { records, total: records.length } };
}
// Mock fetch factory. scenario: { body, httpStatus, invalidJson, abort, networkError, sequence }
function mockFetch(scenario) {
  let calls = 0;
  const fn = async () => {
    calls++;
    const s = scenario.sequence ? scenario.sequence[Math.min(calls - 1, scenario.sequence.length - 1)] : scenario;
    if (s.abort) { const e = new Error("aborted"); e.name = "AbortError"; throw e; }
    if (s.networkError) throw new Error("ECONNRESET");
    return {
      ok: s.httpStatus ? s.httpStatus < 400 : true,
      status: s.httpStatus ?? 200,
      json: async () => { if (s.invalidJson) throw new Error("bad json"); return s.body; },
    };
  };
  fn.calls = () => calls;
  return fn;
}

async function main() {
  // -------------------------------------------------------------------
  section("1. Normalization");
  // -------------------------------------------------------------------
  normalizeRegistration("12345678").digits === "12345678" ? P("8 digits ok") : F("8 digits");
  normalizeRegistration("123-45-678").digits === "12345678" ? P("hyphens stripped") : F("hyphens");
  normalizeRegistration(" 12 345 678 ").digits === "12345678" ? P("spaces stripped") : F("spaces");
  normalizeRegistration("0012345").digits === "0012345" ? P("leading zeros preserved in digits") : F("leading zeros");
  normalizeRegistration("12A45").ok === false ? P("letters rejected") : F("letters");
  normalizeRegistration("1234").ok === false ? P("too short rejected") : F("too short");
  normalizeRegistration("123456789").ok === false ? P("too long rejected") : F("too long");
  normalizeRegistration("").ok === false ? P("empty rejected") : F("empty");
  toNumericFilterValue("0012345") === "12345" ? P("numeric filter drops leading zeros (adapter-only)") : F("numeric filter");
  registrationDuplicateKey("00-12 345") === "12345" ? P("dup key collapses spaces/hyphens/zeros") : F("dup key");
  registrationDuplicateKey(null) === null ? P("null plate has no dup key") : F("null dup key");
  registrationDuplicateKey("   ") === null ? P("blank plate has no dup key") : F("blank dup key");

  // -------------------------------------------------------------------
  section("2. Date parsing + mapper");
  // -------------------------------------------------------------------
  parseFullIsoDate("2027-08-27") === "2027-08-27" ? P("full ISO parsed") : F("full ISO");
  parseFullIsoDate("2011-8") === null ? P("month-only date -> null (no manufactured day)") : F("month-only");
  parseFullIsoDate("garbage") === null ? P("garbage date -> null") : F("garbage date");
  {
    const { vehicle, warnings } = mapGovernmentVehicle(FOUND_RECORD);
    vehicle.make === "טויוטה יפן" ? P("make mapped") : F("make");
    vehicle.model === "COROLLA" ? P("model prefers commercial name") : F("model");
    vehicle.year === 2011 ? P("year mapped") : F("year");
    vehicle.color === "אפור כהה מטלי" ? P("color mapped") : F("color");
    vehicle.fuel_type === "בנזין" ? P("fuel mapped") : F("fuel");
    vehicle.test_expiry_date === "2027-08-27" ? P("test expiry mapped from tokef_dt") : F("expiry");
    vehicle.display.ownership_type === "פרטי" ? P("ownership TYPE is display, not identity") : F("ownership");
    !("owner_name" in vehicle) && !("owner_id" in vehicle) ? P("no owner identity in draft") : F("owner identity leaked");
    warnings.includes("registration_number_had_leading_zero") ? P("leading-zero warning") : F("leading-zero warning");
  }
  {
    const { vehicle, warnings } = mapGovernmentVehicle({ mispar_rechev: "555", degem_nm: "ABC123" });
    vehicle.model === "ABC123" && warnings.includes("model_is_coded") ? P("coded model + warning") : F("coded model");
    warnings.includes("partial_data") ? P("partial data warned when core fields missing") : F("partial warning");
  }
  {
    const { warnings } = mapGovernmentVehicle({ ...FOUND_RECORD, tokef_dt: "2000-01-01" });
    warnings.includes("test_expiry_passed") ? P("expired test date warned") : F("expired warning");
  }

  // -------------------------------------------------------------------
  section("3. Provider transport (mocked fetch)");
  // -------------------------------------------------------------------
  (await queryGovernmentVehicle("12345678", CONFIG, mockFetch({ body: envelope([FOUND_RECORD]) }))).kind === "found"
    ? P("single record -> found") : F("found");
  (await queryGovernmentVehicle("12345678", CONFIG, mockFetch({ body: envelope([]) }))).kind === "not_found"
    ? P("zero records -> not_found") : F("not_found");
  (await queryGovernmentVehicle("12345678", CONFIG, mockFetch({ body: envelope([FOUND_RECORD, FOUND_RECORD]) }))).kind === "ambiguous"
    ? P(">1 record -> ambiguous (never auto-pick)") : F("ambiguous");
  {
    const r = await queryGovernmentVehicle("12345678", CONFIG, mockFetch({ httpStatus: 409 }));
    r.kind === "unavailable" && r.retryable === false ? P("409 -> unavailable, not retryable") : F("409");
  }
  {
    const r = await queryGovernmentVehicle("12345678", CONFIG, mockFetch({ httpStatus: 500 }));
    r.kind === "unavailable" && r.retryable === true ? P("500 -> unavailable, retryable") : F("500");
  }
  {
    const r = await queryGovernmentVehicle("12345678", CONFIG, mockFetch({ httpStatus: 429 }));
    r.kind === "unavailable" && r.retryable === true ? P("429 -> unavailable, retryable") : F("429");
  }
  {
    const r = await queryGovernmentVehicle("12345678", CONFIG, mockFetch({ invalidJson: true }));
    r.kind === "unavailable" ? P("malformed JSON -> unavailable") : F("malformed JSON");
  }
  {
    const r = await queryGovernmentVehicle("12345678", CONFIG, mockFetch({ body: { success: true, result: { records: "nope" } } }));
    r.kind === "unavailable" && r.retryable === false ? P("malformed envelope -> unavailable (not retryable)") : F("malformed envelope");
  }
  {
    const r = await queryGovernmentVehicle("12345678", CONFIG, mockFetch({ body: { success: false } }));
    r.kind === "unavailable" ? P("success:false -> unavailable") : F("success false");
  }
  {
    // unexpected fields ignored (loose schema)
    const rec = { ...FOUND_RECORD, some_new_field: "x", another: 5 };
    (await queryGovernmentVehicle("12345678", CONFIG, mockFetch({ body: envelope([rec]) }))).kind === "found"
      ? P("unexpected fields ignored") : F("unexpected fields");
  }
  {
    // exactly one retry on retryable, then success
    const fetchFn = mockFetch({ sequence: [{ httpStatus: 500 }, { body: envelope([FOUND_RECORD]) }] });
    const r = await queryGovernmentVehicle("12345678", CONFIG, fetchFn);
    r.kind === "found" && fetchFn.calls() === 2 ? P("one retry recovers a 5xx") : F(`retry count ${fetchFn.calls()}`);
  }
  {
    // no retry on 4xx (only one call)
    const fetchFn = mockFetch({ httpStatus: 409 });
    await queryGovernmentVehicle("12345678", CONFIG, fetchFn);
    fetchFn.calls() === 1 ? P("no retry on 4xx") : F(`4xx retried ${fetchFn.calls()}x`);
  }
  {
    // timeout maps to unavailable(timeout)
    const r = await queryGovernmentVehicle("12345678", CONFIG, mockFetch({ abort: true }));
    r.kind === "unavailable" && r.reason === "timeout" ? P("timeout -> unavailable(timeout)") : F("timeout");
  }

  // -------------------------------------------------------------------
  section("4. Service orchestration (mock fetch + injected config)");
  // -------------------------------------------------------------------
  _clearLookupCache();
  (await lookupVehicle("bad!!", { config: CONFIG, fetchImpl: mockFetch({}) })).status === "invalid_registration_number"
    ? P("invalid registration short-circuits (no request)") : F("invalid short-circuit");
  {
    const r = await lookupVehicle("12345678", { config: CONFIG, fetchImpl: mockFetch({ body: envelope([FOUND_RECORD]) }) });
    r.status === "found" && r.source === "israel_government" && r.fetchedAt && r.resourceId === CONFIG.resourceId
      ? P("found result carries source, fetchedAt, resourceId") : F("found envelope");
  }
  {
    _clearLookupCache();
    const r = await lookupVehicle("87654321", { config: CONFIG, fetchImpl: mockFetch({ body: envelope([]) }) });
    r.status === "not_found" ? P("not_found result") : F("not_found result");
  }
  {
    _clearLookupCache();
    const r = await lookupVehicle("11122233", { config: CONFIG, fetchImpl: mockFetch({ body: envelope([FOUND_RECORD, FOUND_RECORD]) }) });
    r.status === "unavailable" && r.reason === "ambiguous" ? P("ambiguous -> unavailable(ambiguous)") : F("ambiguous service");
  }
  {
    // cache: a found lookup is served from cache on the second call (fetch not called again)
    _clearLookupCache();
    const fetchFn = mockFetch({ body: envelope([FOUND_RECORD]) });
    await lookupVehicle("13131313", { config: CONFIG, fetchImpl: fetchFn });
    await lookupVehicle("13131313", { config: CONFIG, fetchImpl: fetchFn });
    fetchFn.calls() === 1 ? P("found result is cached (one fetch for two lookups)") : F(`cache miss (${fetchFn.calls()} fetches)`);
  }
  {
    // failures are never cached as durable states
    _clearLookupCache();
    const fetchFn = mockFetch({ sequence: [{ httpStatus: 500 }, { httpStatus: 500 }, { body: envelope([FOUND_RECORD]) }] });
    await lookupVehicle("14141414", { config: CONFIG, fetchImpl: fetchFn }); // unavailable (2 calls incl retry)
    const r = await lookupVehicle("14141414", { config: CONFIG, fetchImpl: fetchFn }); // retries -> found
    r.status === "found" ? P("provider failure is not cached (later lookup succeeds)") : F("failure was cached");
  }

  // -------------------------------------------------------------------
  section("5. Read-only guarantee (source-level)");
  // -------------------------------------------------------------------
  {
    const svc = read("lib/vehicle-lookup/service.ts");
    const provider = read("lib/vehicle-lookup/israel-government-provider.ts");
    !/supabase/i.test(svc) && !/supabase/i.test(provider)
      ? P("lookup path imports no database client (no write during lookup)") : F("lookup path touches the database");
  }

  // -------------------------------------------------------------------
  section("6. DB migration (local Supabase, guarded)");
  // -------------------------------------------------------------------
  const URL = process.env.SUPABASE_URL, SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (process.env.FLEET_CHECK_ALLOW !== "1" || !URL || !SERVICE) {
    console.log("  SKIP  DB section (set FLEET_CHECK_ALLOW=1 + SUPABASE_URL/SERVICE_ROLE_KEY)");
  } else if (URL.includes("jsthfmgvcdrfzpgkpwvt")) {
    console.error("  Production ref. Aborting DB section."); fails++;
  } else {
    const admin = createClient(URL, SERVICE, { auth: { persistSession: false } });
    const RUN = randomBytes(3).toString("hex");
    const u = (await admin.auth.admin.createUser({ email: `gvl-${RUN}@example.test`, password: "Test-Passw0rd!", email_confirm: true })).data;
    const { data: mem } = await admin.from("organization_members").select("organization_id").eq("user_id", u.user.id).limit(1).maybeSingle();
    const orgId = mem?.organization_id;
    try {
      // new columns accept values
      const ins = await admin.from("vehicles").insert({
        make: "Kia", model: "Niro", year: 2022, mileage_unit: "km", operational_status: "active",
        owner_user_id: u.user.id, organization_id: orgId,
        color: "אפור", fuel_type: "בנזין",
        data_source: "israel_government", government_fetched_at: new Date().toISOString(),
        government_resource_id: CONFIG.resourceId,
      }).select("id, color, fuel_type, data_source, government_resource_id").single();
      !ins.error && ins.data?.data_source === "israel_government"
        ? P("vehicle row stores color/fuel/source metadata") : F(`insert failed: ${ins.error?.message}`);
      ins.data?.fuel_type === "בנזין" ? P("fuel_type persisted") : F("fuel_type");

      // data_source CHECK rejects an unknown value
      const bad = await admin.from("vehicles").insert({
        make: "X", model: "Y", year: 2020, mileage_unit: "km", operational_status: "active",
        owner_user_id: u.user.id, organization_id: orgId, data_source: "totally_bogus",
      }).select("id").maybeSingle();
      bad.error ? P("data_source CHECK rejects an unknown source") : F("bogus data_source accepted (!)");

      // manual create (null data_source) still valid
      const man = await admin.from("vehicles").insert({
        make: "M", model: "N", year: 2019, mileage_unit: "km", operational_status: "active",
        owner_user_id: u.user.id, organization_id: orgId,
      }).select("id, data_source").single();
      !man.error && man.data?.data_source == null ? P("manual create leaves data_source null") : F("manual create");
    } finally {
      await admin.from("vehicles").delete().eq("organization_id", orgId);
      await admin.from("organizations").delete().eq("id", orgId);
      await admin.auth.admin.deleteUser(u.user.id).catch(() => {});
    }
  }

  console.log(`\n${fails === 0 ? "OK" : "FAILED"} — ${passes} passed, ${fails} failed`);
  process.exit(fails === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });

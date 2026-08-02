#!/usr/bin/env node
/**
 * TASK C research spike — Israeli government vehicle lookup by registration number.
 *
 * READ-ONLY. This script is NOT production runtime code. It lives under
 * scripts/research and is never imported by the app. It exists to validate that
 * VIN-ID can retrieve official vehicle data from data.gov.il's CKAN DataStore,
 * map it to a VIN-ID draft, and degrade safely on every failure mode.
 *
 * It:
 *   - normalizes + validates a registration number,
 *   - queries ONLY the official host with a fixed API action and a parameterized
 *     exact-match filter (no SQL, no string interpolation into the query body),
 *   - applies a request timeout,
 *   - handles non-200, malformed JSON, zero results, and >1 results,
 *   - prints a SANITIZED, mapped draft,
 *   - never writes to Supabase and requires no secret.
 *
 * Usage:
 *   node scripts/research/government-vehicle-data-spike.mjs --offline <fixture.json>
 *   node scripts/research/government-vehicle-data-spike.mjs --live <registration-number>
 *
 * Live mode is OPT-IN (--live) so this never calls the network in CI.
 * The exported pure functions below are what the offline test suite exercises.
 */

import { readFileSync } from "node:fs";

// The official, fixed provider configuration. A fixed host + fixed action is a
// security control (no user-controlled URL — see the SSRF discussion in the doc).
export const PROVIDER = {
  host: "https://data.gov.il",
  action: "/api/3/action/datastore_search",
  // Primary resource: private + commercial active vehicles. Treated as
  // configurable, never hard-assumed permanent — see resource-discovery below.
  primaryResourceId: "053cea08-09bc-40ec-8f7a-156f0677aff3",
  filterField: "mispar_rechev",
};

// -----------------------------------------------------------------------------
// Registration-number normalization + validation
// -----------------------------------------------------------------------------
/**
 * Normalize a user-entered Israeli registration number.
 *
 * Strips spaces and hyphens, keeps digits only. Israeli civilian plates are
 * 5–8 digits. The DataStore stores `mispar_rechev` as NUMERIC, so leading zeros
 * are already absent at the source — we therefore query by the integer value and
 * record the original digit string for display/round-trip.
 *
 * Returns { ok:true, query, digits } or { ok:false, reason }.
 */
export function normalizeRegistrationNumber(raw) {
  if (typeof raw !== "string" && typeof raw !== "number") {
    return { ok: false, reason: "empty" };
  }
  const digits = String(raw).replace(/[\s-]/g, "");
  if (digits === "") return { ok: false, reason: "empty" };
  if (!/^\d+$/.test(digits)) return { ok: false, reason: "non_numeric" };
  if (digits.length < 5 || digits.length > 8) {
    return { ok: false, reason: "out_of_range" };
  }
  // Numeric query value (leading zeros dropped to match the numeric column).
  const query = String(Number(digits));
  return { ok: true, query, digits };
}

// -----------------------------------------------------------------------------
// Date interpretation
// -----------------------------------------------------------------------------
/**
 * Parse a government date string into an ISO date (YYYY-MM-DD) or null.
 *
 * Two observed shapes:
 *   - "YYYY-MM-DD"  (tokef_dt, mivchan_acharon_dt)   -> used as-is
 *   - "YYYY-M"      (moed_aliya_lakvish, month only)  -> NOT a full date; we
 *                    return { partial:true, year, month } and no ISO day.
 * Anything else -> { valid:false }.
 */
export function parseGovDate(raw) {
  if (raw == null || raw === "") return { valid: false, iso: null };
  const s = String(raw).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const d = new Date(`${s}T00:00:00Z`);
    return Number.isNaN(d.getTime())
      ? { valid: false, iso: null }
      : { valid: true, iso: s, partial: false };
  }
  const m = /^(\d{4})-(\d{1,2})$/.exec(s);
  if (m) {
    return {
      valid: true,
      iso: null,
      partial: true,
      year: Number(m[1]),
      month: Number(m[2]),
    };
  }
  return { valid: false, iso: null };
}

// -----------------------------------------------------------------------------
// Record → VIN-ID draft mapping
// -----------------------------------------------------------------------------
const trimOrNull = (v) =>
  v == null ? null : String(v).trim() === "" ? null : String(v).trim();

/**
 * Map one DataStore record to a VIN-ID vehicle draft. Only VIN-ID-relevant
 * fields are mapped; owner-type text is exposed as a low-trust display value and
 * is NEVER treated as owner identity. Handles the primary and personal-import
 * schemas (chassis is `misgeret` in one, `shilda` in the other).
 */
export function mapRecord(record) {
  const warnings = [];
  const plate = trimOrNull(record.mispar_rechev);
  if (plate && /^0\d+$/.test(plate)) {
    warnings.push("registration_number_had_leading_zero");
  }

  const chassis = trimOrNull(record.misgeret) ?? trimOrNull(record.shilda);
  const tokef = parseGovDate(record.tokef_dt);
  const lastTest = parseGovDate(record.mivchan_acharon_dt);
  const firstRoad = parseGovDate(record.moed_aliya_lakvish);
  if (record.tokef_dt && !tokef.valid) warnings.push("tokef_dt_unparseable");
  if (record.moed_aliya_lakvish && firstRoad.partial) {
    warnings.push("first_road_date_is_month_precision");
  }

  // Model: prefer the human commercial name, fall back to the coded model name.
  const model = trimOrNull(record.kinuy_mishari) ?? trimOrNull(record.degem_nm);
  if (!trimOrNull(record.kinuy_mishari) && trimOrNull(record.degem_nm)) {
    warnings.push("model_is_coded_degem_nm");
  }

  return {
    // --- MVP: identify + compliance (proposed for the editable draft) ---
    license_plate: plate,
    make: trimOrNull(record.tozeret_nm), // includes country suffix e.g. "טויוטה יפן"
    model,
    year:
      record.shnat_yitzur != null && String(record.shnat_yitzur) !== ""
        ? Number(record.shnat_yitzur)
        : null,
    vin: chassis,
    color: trimOrNull(record.tzeva_rechev),
    fuel_type: trimOrNull(record.sug_delek_nm),
    test_expiry_date: tokef.valid && !tokef.partial ? tokef.iso : null,
    // --- Display-only / future (not written in MVP) ---
    _display: {
      model_code: trimOrNull(record.degem_nm),
      engine_model: trimOrNull(record.degem_manoa),
      last_test_date: lastTest.valid && !lastTest.partial ? lastTest.iso : null,
      first_road: firstRoad.partial
        ? { year: firstRoad.year, month: firstRoad.month }
        : null,
      tyre_front: trimOrNull(record.zmig_kidmi),
      tyre_rear: trimOrNull(record.zmig_ahori),
      ownership_type: trimOrNull(record.baalut), // category, NOT an owner name
      country_of_manufacture: trimOrNull(record.tozeret_eretz_nm),
      import_type: trimOrNull(record.sug_yevu),
    },
    warnings,
  };
}

// -----------------------------------------------------------------------------
// Response interpretation
// -----------------------------------------------------------------------------
/**
 * Turn a parsed CKAN JSON body into a VehicleLookupResult-shaped object.
 * `fetchedAt`/`resourceId` are attached by the caller.
 */
export function interpretResponse(json) {
  if (!json || json.success !== true || typeof json.result !== "object") {
    return { status: "unavailable", retryable: true, reason: "bad_envelope" };
  }
  const records = json.result.records;
  if (!Array.isArray(records)) {
    return { status: "unavailable", retryable: false, reason: "malformed_records" };
  }
  if (records.length === 0) return { status: "not_found" };
  if (records.length > 1) {
    // Exact filter on the primary resource is expected to yield one row; more
    // than one is a data-quality signal, not a hard error. Take the first and warn.
    const draft = mapRecord(records[0]);
    draft.warnings.push("multiple_records_returned");
    return { status: "found", vehicle: draft, extraCount: records.length - 1 };
  }
  return { status: "found", vehicle: mapRecord(records[0]) };
}

// -----------------------------------------------------------------------------
// Live lookup (fetch is injectable so tests never hit the network)
// -----------------------------------------------------------------------------
export async function lookup(
  registration,
  {
    fetchImpl = fetch,
    timeoutMs = 8000,
    resourceId = PROVIDER.primaryResourceId,
  } = {},
) {
  const norm = normalizeRegistrationNumber(registration);
  if (!norm.ok) {
    return { status: "invalid_registration_number", reason: norm.reason };
  }

  const url = new URL(PROVIDER.host + PROVIDER.action);
  url.searchParams.set("resource_id", resourceId);
  // Parameterized exact-match filter — the value is a validated integer string.
  url.searchParams.set(
    "filters",
    JSON.stringify({ [PROVIDER.filterField]: norm.query }),
  );
  url.searchParams.set("limit", "2"); // 2 so we can detect >1 without paging

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const fetchedAt = new Date().toISOString();
  try {
    const res = await fetchImpl(url.toString(), {
      signal: controller.signal,
      headers: { "User-Agent": "vinid-research-spike", Accept: "application/json" },
    });
    if (!res.ok) {
      return {
        status: "unavailable",
        retryable: res.status >= 500 || res.status === 429,
        httpStatus: res.status,
        fetchedAt,
      };
    }
    let json;
    try {
      json = await res.json();
    } catch {
      return { status: "unavailable", retryable: true, reason: "invalid_json", fetchedAt };
    }
    const result = interpretResponse(json);
    return { ...result, source: "israel_government", resourceId, fetchedAt };
  } catch (err) {
    const aborted = err && (err.name === "AbortError" || err.code === "ABORT_ERR");
    return {
      status: "unavailable",
      retryable: true,
      reason: aborted ? "timeout" : "network_error",
      fetchedAt,
    };
  } finally {
    clearTimeout(timer);
  }
}

// -----------------------------------------------------------------------------
// CLI
// -----------------------------------------------------------------------------
function maskDraft(result) {
  // Never print a full plate or chassis, even for a live public record.
  const clone = JSON.parse(JSON.stringify(result));
  const v = clone.vehicle;
  if (v) {
    if (v.license_plate) v.license_plate = v.license_plate.replace(/.(?=.{2})/g, "*");
    if (v.vin) v.vin = "***MASKED***";
  }
  return clone;
}

async function mainCli() {
  const args = process.argv.slice(2);
  if (args[0] === "--offline") {
    const json = JSON.parse(readFileSync(args[1], "utf8"));
    const out = interpretResponse(json);
    console.log(JSON.stringify(maskDraft(out), null, 2));
    return;
  }
  if (args[0] === "--live") {
    const result = await lookup(args[1], { timeoutMs: 8000 });
    console.log(JSON.stringify(maskDraft(result), null, 2));
    return;
  }
  console.error(
    "Usage:\n" +
      "  node government-vehicle-data-spike.mjs --offline <fixture.json>\n" +
      "  node government-vehicle-data-spike.mjs --live <registration-number>",
  );
  process.exit(2);
}

// Run the CLI only when invoked directly (not when imported by the test suite).
if (import.meta.url === `file://${process.argv[1]}`) {
  mainCli().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

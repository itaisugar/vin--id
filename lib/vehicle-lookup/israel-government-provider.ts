import "server-only";

import * as z from "zod";
import { normalizeRegistration, toNumericFilterValue } from "./normalize-registration";
import type { GovVehicleRecord } from "./map-government-vehicle";
import type { VehicleLookupConfig } from "./types";

/**
 * The Israel government (data.gov.il CKAN DataStore) provider adapter.
 *
 * SECURITY: a FIXED host and a FIXED action (`datastore_search`) — there is no
 * user-controlled URL, host, action, or resource id, and no SQL. The only
 * user-derived value is a validated integer registration number, sent as a
 * PARAMETERIZED `filters` value. This is the SSRF/injection boundary.
 *
 * RELIABILITY: 8 s TOTAL budget across at most one retry (retry only on
 * timeout / 429 / 5xx). The CKAN envelope is validated at runtime with zod — we
 * never trust the shape and never spread a provider record into app objects.
 */

// Runtime schema for the CKAN envelope. Records are validated loosely (unknown
// fields ignored) — we only require the transport shape to be sane.
const govRecordSchema = z
  .object({
    mispar_rechev: z.union([z.string(), z.number()]).nullish(),
    tozeret_nm: z.string().nullish(),
    kinuy_mishari: z.string().nullish(),
    degem_nm: z.string().nullish(),
    shnat_yitzur: z.union([z.string(), z.number()]).nullish(),
    tzeva_rechev: z.string().nullish(),
    sug_delek_nm: z.string().nullish(),
    misgeret: z.string().nullish(),
    tokef_dt: z.string().nullish(),
    mivchan_acharon_dt: z.string().nullish(),
    baalut: z.string().nullish(),
  })
  .loose();

const envelopeSchema = z.object({
  success: z.literal(true),
  result: z.object({
    records: z.array(govRecordSchema),
    total: z.union([z.number(), z.string()]).optional(),
  }),
});

export type ProviderOutcome =
  | { kind: "found"; record: GovVehicleRecord }
  | { kind: "not_found" }
  | { kind: "ambiguous" } // exact filter returned >1 row — never auto-pick
  | { kind: "unavailable"; retryable: boolean; reason: "timeout" | "provider_error" | "invalid_response" };

interface Attempt {
  ok: boolean;
  retryable: boolean;
  reason: "timeout" | "provider_error" | "invalid_response" | null;
  outcome: ProviderOutcome | null;
}

/**
 * A single HTTP attempt against the DataStore. `deadline` is the absolute time
 * (ms epoch) the WHOLE operation must finish by, so a retry can never exceed the
 * total budget.
 */
async function attempt(
  numericPlate: string,
  config: VehicleLookupConfig,
  deadline: number,
  fetchImpl: typeof fetch,
): Promise<Attempt> {
  const remaining = deadline - Date.now();
  if (remaining <= 0) {
    return { ok: false, retryable: false, reason: "timeout", outcome: null };
  }

  const url = new URL("datastore_search", config.baseUrl);
  url.searchParams.set("resource_id", config.resourceId);
  url.searchParams.set(
    "filters",
    JSON.stringify({ mispar_rechev: numericPlate }),
  );
  url.searchParams.set("limit", "2"); // detect >1 without paging

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), remaining);
  try {
    const res = await fetchImpl(url.toString(), {
      signal: controller.signal,
      headers: { Accept: "application/json", "User-Agent": "vinid-server" },
    });
    if (!res.ok) {
      const retryable = res.status === 429 || res.status >= 500;
      return { ok: false, retryable, reason: "provider_error", outcome: null };
    }
    let json: unknown;
    try {
      json = await res.json();
    } catch {
      return { ok: false, retryable: true, reason: "invalid_response", outcome: null };
    }
    const parsed = envelopeSchema.safeParse(json);
    if (!parsed.success) {
      return { ok: false, retryable: false, reason: "invalid_response", outcome: null };
    }
    const records = parsed.data.result.records;
    if (records.length === 0) {
      return { ok: true, retryable: false, reason: null, outcome: { kind: "not_found" } };
    }
    if (records.length > 1) {
      return { ok: true, retryable: false, reason: null, outcome: { kind: "ambiguous" } };
    }
    return {
      ok: true,
      retryable: false,
      reason: null,
      outcome: { kind: "found", record: records[0] as GovVehicleRecord },
    };
  } catch (err) {
    const aborted =
      err instanceof Error && (err.name === "AbortError" || err.name === "TimeoutError");
    return {
      ok: false,
      retryable: true,
      reason: aborted ? "timeout" : "provider_error",
      outcome: null,
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Look up one registration number. Returns a low-level provider outcome; the
 * service maps it to the public contract. `fetchImpl` is injectable so tests
 * never hit the network.
 */
export async function queryGovernmentVehicle(
  registration: string,
  config: VehicleLookupConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<ProviderOutcome> {
  const norm = normalizeRegistration(registration);
  if (!norm.ok) {
    // The service validates first; this is a defensive guard.
    return { kind: "unavailable", retryable: false, reason: "invalid_response" };
  }
  const numeric = toNumericFilterValue(norm.digits);
  const deadline = Date.now() + config.timeoutMs;

  let last: Attempt = await attempt(numeric, config, deadline, fetchImpl);
  if (last.ok) return last.outcome!;

  // One retry, only when retryable and time remains.
  if (last.retryable && deadline - Date.now() > 250) {
    last = await attempt(numeric, config, deadline, fetchImpl);
    if (last.ok) return last.outcome!;
  }

  return {
    kind: "unavailable",
    retryable: last.retryable,
    reason: last.reason ?? "provider_error",
  };
}

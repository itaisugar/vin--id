import "server-only";

import type { VehicleLookupConfig } from "./types";

/**
 * Server-only provider configuration.
 *
 * Operational values live here, read once from the environment with safe
 * defaults, so they are not scattered across call sites. NONE of these is a
 * `NEXT_PUBLIC_*` variable — the browser never learns the host, resource id, or
 * timings, and never calls the provider directly.
 *
 * The resource id is NOT a permanent contractual interface (see the spike), so
 * it is isolated behind this config: swapping it is an env change, not a code
 * change. There is deliberately no per-request package discovery — discovery
 * ambiguity must never block a normal lookup. An operator can verify the
 * configured resource out of band via `package_show`.
 */

// Approved primary resource (active private + commercial vehicles), from the
// research decision. Overridable via env for a resource swap without a redeploy.
const DEFAULT_RESOURCE_ID = "053cea08-09bc-40ec-8f7a-156f0677aff3";
const DEFAULT_BASE_URL = "https://data.gov.il/api/3/action/";

export class VehicleLookupConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VehicleLookupConfigError";
  }
}

function positiveInt(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

/**
 * Resolve config, validating the resource id shape. Throws
 * `VehicleLookupConfigError` when the resource id is missing/malformed — the
 * service maps that to an `unavailable(configuration)` result so the UI falls
 * back to manual entry rather than showing an error page.
 */
export function getVehicleLookupConfig(): VehicleLookupConfig {
  const resourceId = (
    process.env.GOV_VEHICLE_RESOURCE_ID || DEFAULT_RESOURCE_ID
  ).trim();
  // CKAN resource ids are UUIDs. Reject anything else so a fat-fingered env var
  // fails clearly instead of producing a "Not Found" on every lookup.
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(resourceId)) {
    throw new VehicleLookupConfigError("GOV_VEHICLE_RESOURCE_ID is not a valid resource id");
  }

  let baseUrl = (process.env.GOV_VEHICLE_API_BASE_URL || DEFAULT_BASE_URL).trim();
  if (!baseUrl.endsWith("/")) baseUrl += "/";
  // Fixed-host safety: only the official host is ever allowed, regardless of env.
  if (!baseUrl.startsWith("https://data.gov.il/")) {
    throw new VehicleLookupConfigError("GOV_VEHICLE_API_BASE_URL must be on https://data.gov.il/");
  }

  return {
    baseUrl,
    resourceId,
    timeoutMs: positiveInt(process.env.GOV_VEHICLE_TIMEOUT_MS, 8000),
    cacheTtlMs: positiveInt(process.env.GOV_VEHICLE_CACHE_MS, 30 * 60 * 1000), // 30 min
    notFoundCacheTtlMs: positiveInt(process.env.GOV_VEHICLE_NOT_FOUND_CACHE_MS, 5 * 60 * 1000),
  };
}

import "server-only";

import { getVehicleLookupConfig, VehicleLookupConfigError } from "./config";
import { queryGovernmentVehicle } from "./israel-government-provider";
import { mapGovernmentVehicle } from "./map-government-vehicle";
import { normalizeRegistration, toNumericFilterValue } from "./normalize-registration";
import type { VehicleLookupConfig, VehicleLookupResult } from "./types";

/**
 * Orchestrates a government vehicle lookup:
 *   normalize → cache → provider → runtime-validated map → public contract.
 *
 * Read-only: it never writes to the database, creates no reminder, and never
 * mutates a vehicle. It returns the typed `VehicleLookupResult` and nothing
 * else — the caller (server action) handles auth, org scoping, and the duplicate
 * annotation.
 *
 * CACHE: a best-effort in-process TTL cache. In a serverless deployment this is
 * per-instance and short-lived — that is fine, it exists to spare the provider
 * repeated identical lookups within a session, not to be a source of truth. It
 * caches `found` (long) and `not_found` (short) only; failures and config errors
 * are NEVER cached as durable states. Cache key includes the resource id, so a
 * resource swap invalidates every prior entry automatically.
 */

const SOURCE = "israel_government" as const;

type CacheEntry = { result: VehicleLookupResult; expiresAt: number };
const cache = new Map<string, CacheEntry>();

function cacheKey(resourceId: string, numeric: string): string {
  return `${SOURCE}:${resourceId}:${numeric}`;
}

/** Test seam: clear the module cache between test cases. */
export function _clearLookupCache(): void {
  cache.clear();
}

export async function lookupVehicle(
  registration: string,
  opts: { fetchImpl?: typeof fetch; config?: VehicleLookupConfig } = {},
): Promise<VehicleLookupResult> {
  const norm = normalizeRegistration(registration);
  if (!norm.ok) return { status: "invalid_registration_number" };

  let config: VehicleLookupConfig;
  try {
    config = opts.config ?? getVehicleLookupConfig();
  } catch (err) {
    if (err instanceof VehicleLookupConfigError) {
      return { status: "unavailable", source: SOURCE, retryable: false, reason: "configuration" };
    }
    throw err;
  }

  const numeric = toNumericFilterValue(norm.digits);
  const key = cacheKey(config.resourceId, numeric);
  const now = Date.now();
  const cached = cache.get(key);
  if (cached && cached.expiresAt > now) return cached.result;
  if (cached) cache.delete(key);

  const outcome = await queryGovernmentVehicle(registration, config, opts.fetchImpl);
  const fetchedAt = new Date().toISOString();

  if (outcome.kind === "not_found") {
    const result: VehicleLookupResult = { status: "not_found", source: SOURCE, fetchedAt };
    cache.set(key, { result, expiresAt: now + config.notFoundCacheTtlMs });
    return result;
  }
  if (outcome.kind === "ambiguous") {
    // More than one record for an exact filter: never auto-pick. Not cached.
    return { status: "unavailable", source: SOURCE, retryable: false, reason: "ambiguous" };
  }
  if (outcome.kind === "unavailable") {
    // Never cache a failure as a durable not-found.
    return { status: "unavailable", source: SOURCE, retryable: outcome.retryable, reason: outcome.reason };
  }

  const { vehicle, warnings } = mapGovernmentVehicle(outcome.record);
  const result: VehicleLookupResult = {
    status: "found",
    source: SOURCE,
    fetchedAt,
    resourceId: config.resourceId,
    vehicle,
    warnings,
  };
  cache.set(key, { result, expiresAt: now + config.cacheTtlMs });
  return result;
}

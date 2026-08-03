/**
 * Shared Israeli registration-number normalization.
 *
 * ONE utility, used by lookup, the duplicate check, and (via the vehicle
 * service) creation — so every path agrees on what "the same plate" means.
 *
 * Rules:
 *   - accept digits, spaces and hyphens; strip the spaces and hyphens;
 *   - reject letters and any other character;
 *   - keep the result as a STRING (never parseInt in application code — that
 *     loses leading zeros and overflows). The official DataStore stores
 *     `mispar_rechev` as a numeric, so leading zeros are already absent at the
 *     source; the numeric filter value is derived ONLY inside the provider
 *     adapter, after validation, from `.digits`;
 *   - validate a reasonable Israeli length (5–8 digits).
 *
 * This module is pure and safe to import on both client and server (it has no
 * server-only dependency), so the Add Vehicle UI can pre-validate before ever
 * hitting the network.
 */

export type RegistrationNormalizeError = "empty" | "non_numeric" | "out_of_range";

export type NormalizedRegistration =
  | { ok: true; /** digits only, leading zeros preserved for display/storage */ digits: string }
  | { ok: false; reason: RegistrationNormalizeError };

const MIN_DIGITS = 5;
const MAX_DIGITS = 8;

export function normalizeRegistration(raw: unknown): NormalizedRegistration {
  if (typeof raw !== "string" && typeof raw !== "number") {
    return { ok: false, reason: "empty" };
  }
  const digits = String(raw).replace(/[\s-]/g, "");
  if (digits === "") return { ok: false, reason: "empty" };
  if (!/^\d+$/.test(digits)) return { ok: false, reason: "non_numeric" };
  if (digits.length < MIN_DIGITS || digits.length > MAX_DIGITS) {
    return { ok: false, reason: "out_of_range" };
  }
  return { ok: true, digits };
}

/**
 * The value the CKAN numeric filter needs. Derived from validated digits only,
 * inside application code that has already normalized — the leading zeros the
 * source lost are dropped here on purpose so the numeric column matches.
 */
export function toNumericFilterValue(digits: string): string {
  return String(Number(digits));
}

/**
 * A stable comparison key for workspace-scoped duplicate detection. Two stored
 * plates that differ only by spaces/hyphens/leading zeros collapse to the same
 * key. Returns null when the input has no usable digits (so null/blank plates
 * are never treated as duplicates of each other).
 */
export function registrationDuplicateKey(raw: unknown): string | null {
  if (raw == null) return null;
  const digits = String(raw).replace(/[\s-]/g, "");
  if (!/^\d+$/.test(digits) || digits === "") return null;
  return String(Number(digits));
}

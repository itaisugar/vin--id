/**
 * Fleet cost calculations.
 *
 * This is deliberately NOT an accounting subsystem. It reports what the fleet
 * has actually recorded, with documented rules for the awkward cases, and says
 * "unknown" rather than inventing a number.
 *
 * ── Where costs come from ────────────────────────────────────────────────────
 * `maintenance_logs.cost` (numeric, nullable) with `maintenance_logs.currency`
 * (text, default 'ILS') is the ONLY cost source used. It is the one table that
 * pairs a monetary amount with a service date, which is what monthly
 * attribution requires.
 *
 * Deliberately excluded:
 *   * `issue_logs` has no cost column at all — repairs are recorded as
 *     maintenance logs, so issue costs are already counted there.
 *   * `vehicle_documents.amount` is the amount stated ON a document (e.g. an
 *     insurance premium). Including it would double-count: a maintenance log
 *     created from a scanned invoice carries `document_id` pointing at that very
 *     document, so the same spend would land in the total twice.
 *   * `vehicle_insurance.cost` / `vehicle_inspection.cost` are policy/test
 *     record fields with no reliable spend date, and are annual rather than
 *     monthly. Rolling them into a monthly operating figure would misstate it.
 *
 * ── Documented rules ────────────────────────────────────────────────────────
 * Attribution date  `performed_at` (the date the work happened). A log with a
 *                   NULL `performed_at` cannot be attributed to a month and is
 *                   excluded from monthly figures — it is counted in
 *                   `undatedCount` so the UI can disclose the gap.
 * NULL cost         Excluded from sums (it is unknown, not zero) and counted in
 *                   `unknownCostCount`.
 * Zero cost         A real, recorded value: included, and it is not "unknown".
 * Negative cost     Excluded and counted in `invalidCount`. The database now
 *                   also rejects new negatives via
 *                   `maintenance_logs_cost_nonnegative`.
 * Duplicates        Not de-duplicated. Two logs for the same work are two
 *                   records; the fleet manager resolves that, not this module.
 * Currency          NEVER converted. Amounts are summed per currency; the
 *                   dominant currency (most records) is reported as the total's
 *                   currency and `mixedCurrency` is set when more than one
 *                   appears, so the UI can disclose rather than mislead.
 */

// -----------------------------------------------------------------------------
// Anomaly rule
// -----------------------------------------------------------------------------
/**
 * A vehicle is "unusually expensive" for the current month when ALL of:
 *
 *   1. the fleet has at least COST_ANOMALY_MIN_VEHICLES (3) vehicles with a
 *      recorded cost this month — below that an "average" is meaningless;
 *   2. the vehicle's month cost is at least COST_ANOMALY_MULTIPLIER (2x) the
 *      mean month cost across those vehicles; and
 *   3. the vehicle's month cost is at least COST_ANOMALY_MIN_ABSOLUTE (1000)
 *      in the reported currency, so a fleet whose costs are all near zero does
 *      not flag noise.
 *
 * Deterministic, stable, and computed in TypeScript from database rows. It is
 * NOT an "AI anomaly" and is never labelled as one.
 */
export const COST_ANOMALY_MULTIPLIER = 2;
export const COST_ANOMALY_MIN_ABSOLUTE = 1000;
export const COST_ANOMALY_MIN_VEHICLES = 3;

/** Default currency, matching the `maintenance_logs.currency` column default. */
export const DEFAULT_CURRENCY = "ILS";

export interface MaintenanceCostRow {
  vehicle_id: string;
  cost: number | string | null;
  currency: string | null;
  performed_at: string | null;
}

export interface VehicleCost {
  vehicleId: string;
  total: number;
  recordCount: number;
}

export interface FleetCostSummary {
  /** Total for the month, in `currency`. */
  monthTotal: number;
  currency: string;
  /** True when the month's records span more than one currency. */
  mixedCurrency: boolean;
  /** Per-vehicle totals for the month, highest first. */
  byVehicle: VehicleCost[];
  /** Mean month cost across vehicles that recorded any cost. */
  averagePerVehicle: number;
  /** Vehicle ids meeting the documented anomaly rule. */
  anomalies: string[];
  /** Records excluded, so the UI can disclose incomplete data. */
  unknownCostCount: number;
  undatedCount: number;
  invalidCount: number;
  /** The month these figures cover, as "yyyy-mm". */
  month: string;
}

/** First day of the current month, "yyyy-mm-dd" in UTC. */
export function monthStartIso(now: Date = new Date()): string {
  return `${now.toISOString().slice(0, 7)}-01`;
}

/** First day of the NEXT month, "yyyy-mm-dd" in UTC (exclusive upper bound). */
export function nextMonthStartIso(now: Date = new Date()): string {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  const next = new Date(Date.UTC(year, month + 1, 1));
  return next.toISOString().slice(0, 10);
}

/** Parse a Postgres numeric, which supabase-js may hand back as a string. */
function toNumber(value: number | string | null): number | null {
  if (value === null) return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Roll maintenance cost rows up into the fleet's month summary.
 *
 * Rows are expected to be pre-filtered to the organization and the month by the
 * caller's query; anything undated or out of range is still handled defensively
 * here so the rules hold regardless of how the rows were fetched.
 */
export function summarizeMonthlyCosts(
  rows: MaintenanceCostRow[],
  now: Date = new Date(),
): FleetCostSummary {
  const month = now.toISOString().slice(0, 7);
  const from = monthStartIso(now);
  const to = nextMonthStartIso(now);

  let unknownCostCount = 0;
  let undatedCount = 0;
  let invalidCount = 0;

  const currencyCounts = new Map<string, number>();
  const totalsByVehicleAndCurrency = new Map<string, Map<string, number>>();
  const recordCounts = new Map<string, number>();

  for (const row of rows) {
    if (!row.performed_at) {
      undatedCount += 1;
      continue;
    }
    const day = row.performed_at.slice(0, 10);
    if (day < from || day >= to) continue;

    const cost = toNumber(row.cost);
    if (cost === null) {
      unknownCostCount += 1;
      continue;
    }
    if (cost < 0) {
      invalidCount += 1;
      continue;
    }

    const currency = (row.currency ?? DEFAULT_CURRENCY).trim() || DEFAULT_CURRENCY;
    currencyCounts.set(currency, (currencyCounts.get(currency) ?? 0) + 1);

    let perCurrency = totalsByVehicleAndCurrency.get(row.vehicle_id);
    if (!perCurrency) {
      perCurrency = new Map();
      totalsByVehicleAndCurrency.set(row.vehicle_id, perCurrency);
    }
    perCurrency.set(currency, (perCurrency.get(currency) ?? 0) + cost);
    recordCounts.set(row.vehicle_id, (recordCounts.get(row.vehicle_id) ?? 0) + 1);
  }

  // Dominant currency = the one with the most records. Ties break alphabetically
  // so the result is stable rather than dependent on row order.
  let currency = DEFAULT_CURRENCY;
  let best = -1;
  for (const [code, count] of [...currencyCounts].sort((a, b) =>
    a[0].localeCompare(b[0]),
  )) {
    if (count > best) {
      best = count;
      currency = code;
    }
  }
  const mixedCurrency = currencyCounts.size > 1;

  // Only the dominant currency is summed — amounts are never converted.
  const byVehicle: VehicleCost[] = [];
  for (const [vehicleId, perCurrency] of totalsByVehicleAndCurrency) {
    const total = perCurrency.get(currency) ?? 0;
    if (total === 0 && !perCurrency.has(currency)) continue;
    byVehicle.push({
      vehicleId,
      total,
      recordCount: recordCounts.get(vehicleId) ?? 0,
    });
  }
  byVehicle.sort((a, b) => b.total - a.total || a.vehicleId.localeCompare(b.vehicleId));

  const monthTotal = byVehicle.reduce((sum, v) => sum + v.total, 0);
  const averagePerVehicle =
    byVehicle.length > 0 ? monthTotal / byVehicle.length : 0;

  const anomalies =
    byVehicle.length >= COST_ANOMALY_MIN_VEHICLES
      ? byVehicle
          .filter(
            (v) =>
              v.total >= averagePerVehicle * COST_ANOMALY_MULTIPLIER &&
              v.total >= COST_ANOMALY_MIN_ABSOLUTE,
          )
          .map((v) => v.vehicleId)
      : [];

  return {
    monthTotal,
    currency,
    mixedCurrency,
    byVehicle,
    averagePerVehicle,
    anomalies,
    unknownCostCount,
    undatedCount,
    invalidCount,
    month,
  };
}

/** Format a cost for display. Never converts; always shows the real currency. */
export function formatCost(
  amount: number,
  currency: string,
  locale: string,
): string {
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    // Unknown currency code — show the number with the code appended rather
    // than throwing or silently dropping the unit.
    return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(amount)} ${currency}`;
  }
}

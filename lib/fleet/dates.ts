/**
 * Centralized deadline logic for the fleet.
 *
 * Every "due soon / overdue" decision in the app must come from here — the
 * dashboard, the vehicles list and the vehicle page all share these helpers so
 * the definitions can never drift apart.
 *
 * Definitions (per spec):
 *   overdue   — the date is before today
 *   due soon  — the date is today or within DUE_SOON_DAYS days
 *   upcoming  — further out than that
 *
 * DATE HANDLING: the DB columns are Postgres `date` (no time, no zone) and
 * arrive as "yyyy-mm-dd" strings. All comparisons are done on the calendar day
 * in UTC. Parsing with `new Date("yyyy-mm-dd")` yields UTC midnight, and
 * `todayUtcIso()` takes the UTC day, so both sides use the same reference and a
 * user in UTC+3 cannot see a deadline flip a day early. This is intentionally
 * NOT locale/timezone aware: a "test expires on the 4th" is the same calendar
 * day everywhere.
 */

/** Due-soon window in days. Shared with the reminders module's own window. */
export const DUE_SOON_DAYS = 30;

/** Mileage window (unit-agnostic) for "service due soon by KM". */
export const DUE_SOON_KM = 1000;

export type DeadlineState = "overdue" | "due_soon" | "upcoming";

const MS_PER_DAY = 86_400_000;

/** Today as "yyyy-mm-dd" in UTC. */
export function todayUtcIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Parse a "yyyy-mm-dd" date column into UTC-midnight ms, or null if invalid. */
function parseDateColumn(value: string | null | undefined): number | null {
  if (!value) return null;
  const ms = Date.parse(`${value.slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(ms) ? null : ms;
}

/**
 * Whole days from today until `value`.
 * Negative = in the past. Null when the date is missing or unparseable.
 */
export function daysUntil(
  value: string | null | undefined,
  now: Date = new Date(),
): number | null {
  const target = parseDateColumn(value);
  if (target === null) return null;

  const todayMs = Date.parse(`${now.toISOString().slice(0, 10)}T00:00:00Z`);
  return Math.round((target - todayMs) / MS_PER_DAY);
}

/** Classify a date deadline. Null when there is no date to classify. */
export function classifyDeadline(
  value: string | null | undefined,
  now: Date = new Date(),
): DeadlineState | null {
  const days = daysUntil(value, now);
  if (days === null) return null;
  if (days < 0) return "overdue";
  if (days <= DUE_SOON_DAYS) return "due_soon";
  return "upcoming";
}

/** True when the deadline needs the fleet manager's attention now. */
export function isActionableDeadline(
  value: string | null | undefined,
  now: Date = new Date(),
): boolean {
  const state = classifyDeadline(value, now);
  return state === "overdue" || state === "due_soon";
}

/**
 * Classify a mileage-based service deadline.
 * Returns null when either value is missing — a missing odometer reading is not
 * evidence that a service is due.
 */
export function classifyKmDeadline(
  dueKm: number | null | undefined,
  currentKm: number | null | undefined,
): DeadlineState | null {
  if (dueKm == null || currentKm == null) return null;
  const remaining = dueKm - currentKm;
  if (remaining < 0) return "overdue";
  if (remaining <= DUE_SOON_KM) return "due_soon";
  return "upcoming";
}

/** Most severe of a set of deadline states (null-safe). */
export function worstDeadline(
  ...states: (DeadlineState | null)[]
): DeadlineState | null {
  if (states.includes("overdue")) return "overdue";
  if (states.includes("due_soon")) return "due_soon";
  if (states.includes("upcoming")) return "upcoming";
  return null;
}

/** Badge tone for a deadline state. Always paired with a text label in the UI. */
export const DEADLINE_TONE: Record<
  DeadlineState,
  "danger" | "warning" | "muted"
> = {
  overdue: "danger",
  due_soon: "warning",
  upcoming: "muted",
};

/**
 * Sort key for "closest deadline first". Missing dates sort last rather than
 * first, so vehicles with no data don't crowd out real deadlines.
 */
export function deadlineSortKey(value: string | null | undefined): number {
  const days = daysUntil(value);
  return days === null ? Number.POSITIVE_INFINITY : days;
}

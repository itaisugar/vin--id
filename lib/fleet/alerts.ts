/**
 * Fleet alert rules — the single, deterministic definition of "what requires
 * attention today".
 *
 * Everything here is plain arithmetic on database values. No LLM is involved in
 * any calculation on this page, and none of these numbers is ever estimated or
 * fabricated: a value that cannot be computed from real records is reported as
 * unknown rather than guessed.
 *
 * Thresholds live in ONE place (below) so the dashboard, the vehicle list and
 * the vehicle detail page can never drift apart.
 */

import {
  classifyDeadline,
  classifyKmDeadline,
  DUE_SOON_DAYS,
  DUE_SOON_KM,
  type DeadlineState,
} from "./dates";
import type { OperationalStatus } from "./types";

// -----------------------------------------------------------------------------
// Documented thresholds
// -----------------------------------------------------------------------------
/**
 * | Rule                      | Threshold                                    |
 * | ------------------------- | -------------------------------------------- |
 * | Service overdue (date)    | next_service_date is before today            |
 * | Service due soon (date)   | next_service_date within DUE_SOON_DAYS (30)  |
 * | Service overdue (mileage) | next_service_km <= current_mileage           |
 * | Service due soon (mileage)| within DUE_SOON_KM (1000) of next_service_km |
 * | Document expired          | expiry_date is before today                  |
 * | Document expiring soon    | expiry_date within DOC_EXPIRING_DAYS (30)    |
 * | High-priority issue       | severity in HIGH_PRIORITY_ISSUE_SEVERITIES   |
 * | Repeated issues           | >= REPEATED_ISSUE_THRESHOLD (2) open issues  |
 *
 * A `next_service_km` BELOW the current odometer reading is overdue, not bad
 * data — a fleet that drove past its service interval is exactly the case this
 * product exists to catch, so it is never rejected as invalid.
 */
export const DOC_EXPIRING_DAYS = DUE_SOON_DAYS;
export const REPEATED_ISSUE_THRESHOLD = 2;

export { DUE_SOON_DAYS, DUE_SOON_KM };

/**
 * Issue severities that count as high priority. These are the real values from
 * the `issue_logs_severity_check` constraint — no invented priority levels.
 * Full set: info | monitor | diy_simple | mechanic_recommended | urgent |
 * stop_immediately.
 */
export const HIGH_PRIORITY_ISSUE_SEVERITIES = [
  "urgent",
  "stop_immediately",
] as const;

export type IssueSeverity = string;

export function isHighPriorityIssue(severity: IssueSeverity | null): boolean {
  return (
    severity !== null &&
    (HIGH_PRIORITY_ISSUE_SEVERITIES as readonly string[]).includes(severity)
  );
}

/** Issue statuses that count as open, from `issue_logs_status_check`. */
export const OPEN_ISSUE_STATUSES = ["open", "monitoring"] as const;

// -----------------------------------------------------------------------------
// Service status
// -----------------------------------------------------------------------------
export interface ServiceStatus {
  /** Worst of the date-based and mileage-based signals. */
  state: DeadlineState | null;
  byDate: DeadlineState | null;
  byMileage: DeadlineState | null;
  date: string | null;
  dueKm: number | null;
  /** Distance still to run before the service is due; negative = overrun. */
  kmRemaining: number | null;
  /** True when neither a date nor a mileage target exists to judge against. */
  unknown: boolean;
}

export function getServiceStatus(vehicle: {
  next_service_date: string | null;
  next_service_km: number | null;
  current_mileage: number | null;
}): ServiceStatus {
  const byDate = classifyDeadline(vehicle.next_service_date);
  const byMileage = classifyKmDeadline(
    vehicle.next_service_km,
    vehicle.current_mileage,
  );

  const state =
    byDate === "overdue" || byMileage === "overdue"
      ? "overdue"
      : byDate === "due_soon" || byMileage === "due_soon"
        ? "due_soon"
        : byDate === "upcoming" || byMileage === "upcoming"
          ? "upcoming"
          : null;

  const kmRemaining =
    vehicle.next_service_km != null && vehicle.current_mileage != null
      ? vehicle.next_service_km - vehicle.current_mileage
      : null;

  return {
    state,
    byDate,
    byMileage,
    date: vehicle.next_service_date,
    dueKm: vehicle.next_service_km,
    kmRemaining,
    // A vehicle with no service target at all cannot be judged. This is
    // surfaced as "not enough data", never silently counted as healthy.
    unknown: byDate === null && byMileage === null,
  };
}

// -----------------------------------------------------------------------------
// Document status
// -----------------------------------------------------------------------------
/**
 * What the fleet knows about a vehicle's paperwork.
 *
 * NAMING RULE: a count of documents counts DOCUMENT RECORDS; a count of
 * vehicles is named for vehicles. The previous dashboard tile said "Documents
 * to handle" while counting vehicles — the two are reported separately here so
 * a label can never describe the wrong thing.
 *
 * Sources, both real:
 *   * `vehicles.test_expiry_date` / `insurance_expiry_date` — the statutory
 *     dates a fleet manager tracks per vehicle.
 *   * `vehicle_documents.expiry_date` — uploaded documents that carry an expiry.
 *
 * MISSING DOCUMENTS: the schema has no per-organization policy of which
 * documents are required, so "missing" cannot be derived reliably and is NOT
 * claimed. The only honest missing-signal available is the explicit
 * `operational_status = 'documents_missing'` a human set, which is reported
 * under its own name. No compliance percentage is fabricated.
 */
export interface DocumentStatus {
  testState: DeadlineState | null;
  insuranceState: DeadlineState | null;
  /** Worst state across the vehicle's dates AND its uploaded documents. */
  worst: DeadlineState | null;
  /** Nearest expiry date of anything tracked for this vehicle. */
  nearestExpiry: string | null;
  expiredCount: number;
  expiringCount: number;
  /** A human explicitly flagged this vehicle as missing paperwork. */
  flaggedMissing: boolean;
}

export function classifyDocumentExpiry(
  expiry: string | null,
): DeadlineState | null {
  return classifyDeadline(expiry);
}

// -----------------------------------------------------------------------------
// Operational status
// -----------------------------------------------------------------------------
/**
 * Operational status is STORED, never inferred. A vehicle explicitly marked
 * `out_of_service` stays out of service even if all of its deadlines are clean,
 * and a vehicle marked `active` is never silently re-labelled by this module —
 * derived signals (overdue service, expired documents, open issues) are surfaced
 * as their own alerts alongside the stored status rather than overwriting it.
 */
export const OPERATIONAL_GROUPS = {
  /** Available for work. */
  operational: ["active"],
  /** Working, but something needs handling. */
  attention: ["needs_service", "issue_open", "documents_missing"],
  /** Not available for work. */
  unavailable: ["out_of_service", "in_garage"],
} as const satisfies Record<string, readonly OperationalStatus[]>;

export type OperationalGroup = keyof typeof OPERATIONAL_GROUPS;

export function operationalGroup(status: OperationalStatus): OperationalGroup {
  if ((OPERATIONAL_GROUPS.operational as readonly string[]).includes(status)) {
    return "operational";
  }
  if ((OPERATIONAL_GROUPS.unavailable as readonly string[]).includes(status)) {
    return "unavailable";
  }
  return "attention";
}

// -----------------------------------------------------------------------------
// Action urgency
// -----------------------------------------------------------------------------
/**
 * One row of "what requires action today". Every action names the vehicle it
 * belongs to and links to the record that resolves it — a number with no
 * destination is not an action.
 */
export const ACTION_TYPES = [
  "service_overdue",
  "service_due_soon",
  "document_expired",
  "document_expiring",
  "issue_high_priority",
  "issue_open",
  "status_unavailable",
  "missing_service_data",
  "cost_anomaly",
] as const;
export type ActionType = (typeof ACTION_TYPES)[number];

/**
 * Stable urgency ordering, highest first:
 *   1 overdue / expired
 *   2 urgent open issues
 *   3 due soon / expiring soon
 *   4 missing information
 *   5 cost anomaly
 */
export const URGENCY_RANK: Record<ActionType, number> = {
  service_overdue: 1,
  document_expired: 1,
  status_unavailable: 1,
  issue_high_priority: 2,
  service_due_soon: 3,
  document_expiring: 3,
  issue_open: 3,
  missing_service_data: 4,
  cost_anomaly: 5,
};

export type UrgencyLevel = "critical" | "high" | "soon" | "info";

export function urgencyLevel(type: ActionType): UrgencyLevel {
  const rank = URGENCY_RANK[type];
  if (rank === 1) return "critical";
  if (rank === 2) return "high";
  if (rank === 3) return "soon";
  return "info";
}

export interface FleetAction {
  id: string;
  vehicleId: string;
  vehicleLabel: string;
  licensePlate: string | null;
  type: ActionType;
  urgency: UrgencyLevel;
  /** ISO date driving the action, when one applies. */
  date: string | null;
  /** Extra detail for the reason line (document type, issue title, km, cost). */
  detail?: string | null;
  /** Numeric payload for actions whose reason is a quantity. */
  count?: number;
  /** Where this action is resolved. */
  href: string;
}

/**
 * Order actions by urgency, then by how overdue they are, then by plate so the
 * list is stable across renders.
 */
export function compareActions(a: FleetAction, b: FleetAction): number {
  const byRank = URGENCY_RANK[a.type] - URGENCY_RANK[b.type];
  if (byRank !== 0) return byRank;

  const aDate = a.date ? Date.parse(a.date) : Number.POSITIVE_INFINITY;
  const bDate = b.date ? Date.parse(b.date) : Number.POSITIVE_INFINITY;
  if (aDate !== bDate) return aDate - bDate;

  return (a.licensePlate ?? "").localeCompare(b.licensePlate ?? "");
}

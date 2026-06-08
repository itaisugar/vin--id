import {
  RECENT_SERVICE_DAYS,
  RECENT_SERVICE_MILEAGE,
  type SnapshotIssue,
  type SnapshotMaintenance,
  type SnapshotVehicle,
} from "./types";

/** Trust levels that count as externally backed (not just user-entered). */
const BACKED_TRUST = new Set([
  "document_backed",
  "ai_extracted",
  "mechanic_verified",
]);

export function backedMaintenanceCount(
  maintenance: SnapshotMaintenance[],
): number {
  return maintenance.filter((m) => BACKED_TRUST.has(m.trust_level)).length;
}

/** Build dated mileage points from maintenance + issues (where both exist). */
function mileagePoints(
  maintenance: SnapshotMaintenance[],
  issues: SnapshotIssue[],
): { date: number; mileage: number }[] {
  const points: { date: number; mileage: number }[] = [];
  for (const m of maintenance) {
    if (m.date && m.mileage != null) {
      points.push({ date: Date.parse(m.date), mileage: m.mileage });
    }
  }
  for (const i of issues) {
    if (i.date && i.mileage != null) {
      points.push({ date: Date.parse(i.date), mileage: i.mileage });
    }
  }
  return points.filter((p) => !Number.isNaN(p.date));
}

/**
 * Mileage is inconsistent when, ordered by date, a later record shows a lower
 * mileage than an earlier one. Needs at least two data points to judge.
 */
export function isMileageInconsistent(
  maintenance: SnapshotMaintenance[],
  issues: SnapshotIssue[],
): boolean {
  const points = mileagePoints(maintenance, issues).sort(
    (a, b) => a.date - b.date,
  );
  if (points.length < 2) return false;
  let prev = points[0].mileage;
  for (let i = 1; i < points.length; i++) {
    if (points[i].mileage < prev) return true;
    prev = points[i].mileage;
  }
  return false;
}

/** Whether mileage sequence has enough data to be considered consistent. */
export function mileageHasSequence(
  maintenance: SnapshotMaintenance[],
  issues: SnapshotIssue[],
): boolean {
  return mileagePoints(maintenance, issues).length >= 2;
}

export function hasRecentService(
  maintenance: SnapshotMaintenance[],
  vehicle: SnapshotVehicle,
): boolean {
  if (maintenance.length === 0) return false;

  const now = Date.now();
  const withDates = maintenance
    .map((m) => (m.date ? Date.parse(m.date) : NaN))
    .filter((t) => !Number.isNaN(t));
  if (withDates.length > 0) {
    const latest = Math.max(...withDates);
    const days = (now - latest) / 86_400_000;
    if (days <= RECENT_SERVICE_DAYS) return true;
  }

  if (vehicle.current_mileage != null) {
    const mileages = maintenance
      .map((m) => m.mileage)
      .filter((v): v is number => v != null);
    if (mileages.length > 0) {
      const maxServiceMileage = Math.max(...mileages);
      if (vehicle.current_mileage - maxServiceMileage <= RECENT_SERVICE_MILEAGE) {
        return true;
      }
    }
  }

  return false;
}

export function hasUnresolvedUrgentIssue(issues: SnapshotIssue[]): boolean {
  return issues.some(
    (i) =>
      (i.severity === "urgent" || i.severity === "stop_immediately") &&
      i.status !== "resolved",
  );
}

/** Case-insensitive keyword check across maintenance + issue text. */
export function mentionsAny(
  maintenance: SnapshotMaintenance[],
  issues: SnapshotIssue[],
  keywords: string[],
): boolean {
  const haystack = [
    ...maintenance.map((m) => `${m.category ?? ""} ${m.description ?? ""}`),
    ...issues.map((i) => `${i.symptoms ?? ""} ${i.resolution_notes ?? ""}`),
  ]
    .join(" ")
    .toLowerCase();
  return keywords.some((k) => haystack.includes(k));
}

export function vehicleBasicsComplete(vehicle: SnapshotVehicle): boolean {
  return (
    Boolean(vehicle.make) &&
    Boolean(vehicle.model) &&
    vehicle.year != null &&
    vehicle.current_mileage != null
  );
}

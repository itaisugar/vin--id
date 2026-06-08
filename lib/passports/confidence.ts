import {
  backedMaintenanceCount,
  hasRecentService,
  hasUnresolvedUrgentIssue,
  isMileageInconsistent,
  mileageHasSequence,
  vehicleBasicsComplete,
} from "./analysis";
import type { PassportSnapshot } from "./types";

/**
 * Deterministic Record Confidence Score (0–100). Measures how well the history
 * is DOCUMENTED — not the mechanical condition of the vehicle. The same inputs
 * always produce the same score.
 */
export function computeRecordConfidence(
  snapshot: Pick<
    PassportSnapshot,
    "vehicle" | "maintenance" | "issues" | "documents" | "included_scopes"
  >,
): number {
  const { vehicle, maintenance, issues, documents, included_scopes } = snapshot;
  const issuesIncluded = included_scopes.includes("issues");

  let score = 0;

  // +10 complete vehicle basics
  if (vehicleBasicsComplete(vehicle)) score += 10;

  // +15 at least 3 maintenance records
  if (maintenance.length >= 3) score += 15;

  // +20 at least 50% of maintenance records are externally backed
  if (
    maintenance.length > 0 &&
    backedMaintenanceCount(maintenance) / maintenance.length >= 0.5
  ) {
    score += 20;
  }

  // +10 mileage sequence appears consistent (needs >= 2 data points)
  const inconsistent = isMileageInconsistent(maintenance, issues);
  if (mileageHasSequence(maintenance, issues) && !inconsistent) score += 10;

  // +10 recent service exists
  if (hasRecentService(maintenance, vehicle)) score += 10;

  // +10 at least one shareable document included
  if (documents.length > 0) score += 10;

  // +/- issue history
  if (issuesIncluded) score += 10;
  else score -= 10;

  // -10 no documents included
  if (documents.length === 0) score -= 10;

  // -20 mileage inconsistency detected
  if (inconsistent) score -= 20;

  // -20 unresolved urgent / stop_immediately issue (among included issues)
  if (hasUnresolvedUrgentIssue(issues)) score -= 20;

  return Math.max(0, Math.min(100, score));
}

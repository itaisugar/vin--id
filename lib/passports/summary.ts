import {
  backedMaintenanceCount,
  hasRecentService,
  hasUnresolvedUrgentIssue,
  isMileageInconsistent,
  mentionsAny,
} from "./analysis";
import type { PassportSnapshot, PassportSummary } from "./types";

/**
 * Deterministic passport summary (NO AI). Returns stable CODES that the UI
 * maps to cautious, translated text. Stored in vehicle_passports.ai_summary so
 * a future real-AI summary can replace it in the same column.
 *
 * TODO(real-ai-summary): replace with an AI provider (MOCK_AI by default) that
 * still requires owner confirmation before saving.
 */
export function buildPassportSummary(
  snapshot: Pick<
    PassportSnapshot,
    "vehicle" | "maintenance" | "issues" | "documents" | "missing_or_not_shared"
  >,
): PassportSummary {
  const { maintenance, issues, documents, missing_or_not_shared } = snapshot;

  const strengths: string[] = [];
  const attention_points: string[] = [];
  const recommended_checks: string[] = [];
  const missing: string[] = [];

  // Strengths
  if (backedMaintenanceCount(maintenance) >= 2) {
    strengths.push("document_backed_maintenance");
  }
  if (hasRecentService(maintenance, snapshot.vehicle)) {
    strengths.push("recent_service");
  }
  if (documents.length > 0) strengths.push("shareable_documents");
  if (issues.length > 0) strengths.push("issue_history_present");

  // Attention points
  if (documents.length === 0) attention_points.push("no_documents");
  if (hasUnresolvedUrgentIssue(issues)) {
    attention_points.push("unresolved_urgent_issue");
  }
  if (isMileageInconsistent(maintenance, issues)) {
    attention_points.push("mileage_inconsistency");
  }

  // Recommended checks — when a common wear item is never mentioned
  if (!mentionsAny(maintenance, issues, ["tire", "tyre", "צמיג"])) {
    recommended_checks.push("tires");
  }
  if (!mentionsAny(maintenance, issues, ["batter", "מצבר"])) {
    recommended_checks.push("battery");
  }
  if (!mentionsAny(maintenance, issues, ["brake", "בלם", "בלמים"])) {
    recommended_checks.push("brakes");
  }

  // Missing / not shared (mirrors snapshot flags)
  if (missing_or_not_shared.issue_history_excluded) {
    missing.push("issue_history_excluded");
  }
  if (missing_or_not_shared.documents_excluded_count > 0) {
    missing.push("documents_excluded");
  }
  if (missing_or_not_shared.personal_documents_excluded_count > 0) {
    missing.push("personal_documents_excluded");
  }
  if (missing_or_not_shared.no_document_backed_records) {
    missing.push("no_document_backed_records");
  }
  if (missing_or_not_shared.no_recent_service) {
    missing.push("no_recent_service");
  }

  return {
    strengths,
    attention_points,
    recommended_checks,
    missing_or_not_shared: missing,
    generated: "deterministic",
  };
}

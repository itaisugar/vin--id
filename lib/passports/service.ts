import "server-only";

import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getAppBaseUrl } from "@/lib/app-url";
import { createClient } from "@/lib/supabase/server";
import { listDocuments } from "@/lib/documents/service";
import { listIssues } from "@/lib/issues/service";
import { listMaintenanceLogs } from "@/lib/maintenance/service";
import { listReminders } from "@/lib/reminders/service";
import {
  getVehicleById,
  NotAuthenticatedError,
} from "@/lib/vehicles/service";
import { backedMaintenanceCount, hasRecentService } from "./analysis";
import { computeRecordConfidence } from "./confidence";
import { generateTransferToken, hashSnapshot } from "./snapshot";
import { buildPassportSummary } from "./summary";
import {
  PASSPORT_COLUMNS,
  TOKEN_TTL_HOURS,
  type PassportOptions,
  type PassportScope,
  type PassportSnapshot,
  type SnapshotDocument,
  type SnapshotIssue,
  type SnapshotMaintenance,
  type SnapshotReminder,
  type VehiclePassport,
} from "./types";

export class VehicleNotFoundError extends Error {
  constructor() {
    super("Vehicle not found");
    this.name = "VehicleNotFoundError";
  }
}
export class PassportNotFoundError extends Error {
  constructor() {
    super("Passport not found");
    this.name = "PassportNotFoundError";
  }
}

const PASSPORT_LIST_COLUMNS =
  "id, status, version, snapshot_hash, record_confidence_score, issued_at, expires_at, created_at";

export interface PassportListItem {
  id: string;
  status: VehiclePassport["status"];
  version: number;
  snapshot_hash: string | null;
  record_confidence_score: number | null;
  issued_at: string | null;
  expires_at: string | null;
  created_at: string;
}

export interface PassportCounts {
  maintenance: number;
  issues: number;
  reminders: number;
  documentsTotal: number;
  documentsShareable: number;
  documentsPersonalShareable: number;
  documentsNonShareable: number;
}

async function getUserId(supabase: SupabaseClient): Promise<string> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new NotAuthenticatedError();
  return user.id;
}

/** Available item counts per scope, for the create page. */
export async function getPassportCounts(
  vehicleId: string,
): Promise<PassportCounts> {
  const [maintenance, issues, documents, reminders] = await Promise.all([
    listMaintenanceLogs(vehicleId),
    listIssues(vehicleId),
    listDocuments(vehicleId),
    listReminders(vehicleId),
  ]);

  const shareable = documents.filter((d) => d.share_allowed);
  return {
    maintenance: maintenance.length,
    issues: issues.length,
    reminders: reminders.filter((r) => r.status === "pending").length,
    documentsTotal: documents.length,
    documentsShareable: shareable.length,
    documentsPersonalShareable: shareable.filter((d) => d.contains_personal_info)
      .length,
    documentsNonShareable: documents.filter((d) => !d.share_allowed).length,
  };
}

/**
 * Create a frozen passport snapshot. Returns the id + one-time share URL.
 * `shareUrl` is `null` when the public base URL is not configured (production
 * misconfiguration) — the passport + token are still created, so the UI can
 * surface a clear message instead of showing a broken/localhost link.
 */
export async function createPassport(
  vehicleId: string,
  options: PassportOptions,
): Promise<{ passportId: string; shareUrl: string | null }> {
  const supabase = await createClient();
  const userId = await getUserId(supabase);

  const vehicle = await getVehicleById(vehicleId);
  if (!vehicle) throw new VehicleNotFoundError();

  const [allMaintenance, allIssues, allDocuments, allReminders] =
    await Promise.all([
      listMaintenanceLogs(vehicleId),
      listIssues(vehicleId),
      listDocuments(vehicleId),
      listReminders(vehicleId),
    ]);

  // ---- Apply scope + document eligibility rules ----------------------------
  const maintenance: SnapshotMaintenance[] = options.includeMaintenance
    ? allMaintenance.map((m) => ({
        id: m.id,
        date: m.performed_at,
        mileage: m.mileage,
        category: m.service_type,
        description: m.description,
        cost: m.cost,
        currency: m.currency,
        trust_level: m.trust_label,
        source_type: m.source_type,
      }))
    : [];

  const issues: SnapshotIssue[] = options.includeIssues
    ? allIssues.map((i) => ({
        id: i.id,
        date: i.reported_at,
        mileage: i.mileage,
        symptoms: i.title,
        status: i.status,
        severity: i.severity,
        resolution_notes: i.resolution_notes,
        trust_level: i.trust_label,
        source_type: i.source_type,
      }))
    : [];

  // Documents: only share_allowed; personal-info docs excluded unless opted in.
  const eligibleDocs = options.includeDocuments
    ? allDocuments.filter(
        (d) =>
          d.share_allowed &&
          (options.includePersonalDocs || !d.contains_personal_info),
      )
    : [];
  const documents: SnapshotDocument[] = eligibleDocs.map((d) => ({
    id: d.id,
    file_name: d.file_name,
    mime_type: d.mime_type,
    document_type: d.doc_type,
    document_date: d.document_date,
    expiry_date: d.expiry_date,
    vendor: d.vendor,
    amount: d.amount,
    currency: d.currency,
    contains_personal_info: d.contains_personal_info,
    share_allowed: d.share_allowed,
    trust_level: d.trust_label,
    // vehicle_documents has no source_type column; documents are user uploads.
    source_type: "user",
  }));

  const reminders: SnapshotReminder[] = options.includeReminders
    ? allReminders.map((r) => ({
        id: r.id,
        title: r.title,
        description: r.description,
        reminder_type: r.reminder_type,
        due_date: r.due_date,
        due_mileage: r.due_mileage,
        urgency: r.urgency,
        status: r.status,
      }))
    : [];

  const includedScopes: PassportScope[] = [];
  if (options.includeMaintenance) includedScopes.push("maintenance");
  if (options.includeIssues) includedScopes.push("issues");
  if (options.includeDocuments) includedScopes.push("documents");
  if (options.includeReminders) includedScopes.push("reminders");

  const eligibleIds = new Set(documents.map((d) => d.id));
  const missing = {
    issue_history_excluded: !options.includeIssues,
    documents_excluded_count: allDocuments.length - documents.length,
    personal_documents_excluded_count: allDocuments.filter(
      (d) => d.contains_personal_info && !eligibleIds.has(d.id),
    ).length,
    no_document_backed_records: backedMaintenanceCount(maintenance) === 0,
    no_recent_service: !hasRecentService(maintenance, {
      vehicle_id: vehicle.id,
      make: vehicle.make,
      model: vehicle.model,
      year: vehicle.year,
      vin: vehicle.vin,
      license_plate: vehicle.license_plate,
      current_mileage: vehicle.current_mileage,
      mileage_unit: vehicle.mileage_unit,
      status: vehicle.status,
    }),
  };

  const passportId = randomUUID();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + TOKEN_TTL_HOURS * 3_600_000);

  const snapshot: PassportSnapshot = {
    meta: {
      passport_id: passportId,
      version: 1,
      created_at: now.toISOString(),
      expires_at: expiresAt.toISOString(),
      issuer_user_id: userId,
    },
    vehicle: {
      vehicle_id: vehicle.id,
      make: vehicle.make,
      model: vehicle.model,
      year: vehicle.year,
      vin: vehicle.vin,
      license_plate: vehicle.license_plate,
      current_mileage: vehicle.current_mileage,
      mileage_unit: vehicle.mileage_unit,
      status: vehicle.status,
    },
    included_scopes: includedScopes,
    maintenance,
    issues,
    documents,
    reminders,
    missing_or_not_shared: missing,
    disclaimer: {
      not_official_ownership_document: true,
      not_mechanical_certification: true,
      record_confidence_not_condition_score: true,
    },
  };

  const snapshotHash = hashSnapshot(snapshot);
  const score = computeRecordConfidence(snapshot);
  const summary = buildPassportSummary(snapshot);

  // Insert the passport (server-derived owner). RLS + explicit owner filter.
  const { error: passportError } = await supabase
    .from("vehicle_passports")
    .insert({
      id: passportId,
      owner_user_id: userId,
      vehicle_id: vehicleId,
      status: "active",
      version: 1,
      snapshot,
      snapshot_hash: snapshotHash,
      record_confidence_score: score,
      ai_summary: summary,
      server_signature: null, // TODO(server-signature): sign snapshot_hash
      issued_at: now.toISOString(),
      expires_at: expiresAt.toISOString(),
    });
  if (passportError) throw passportError;

  // Create the transfer token (store hash only). Raw token returned once.
  const { token, tokenHash } = generateTransferToken();
  const { error: tokenError } = await supabase.from("transfer_tokens").insert({
    owner_user_id: userId,
    passport_id: passportId,
    vehicle_id: vehicleId,
    token_hash: tokenHash,
    status: "active",
    expires_at: expiresAt.toISOString(),
  });
  if (tokenError) throw tokenError;

  // Build the one-time share URL. If the public base URL is misconfigured we
  // must NOT fail the whole creation (snapshot + token already exist) — return
  // a null shareUrl and let the UI explain it. Never emit a localhost link.
  let shareUrl: string | null = null;
  try {
    shareUrl = `${await getAppBaseUrl()}/p/${token}`;
  } catch {
    shareUrl = null;
  }

  return { passportId, shareUrl };
}

export async function listPassports(
  vehicleId: string,
): Promise<PassportListItem[]> {
  const supabase = await createClient();
  const userId = await getUserId(supabase);

  const { data, error } = await supabase
    .from("vehicle_passports")
    .select(PASSPORT_LIST_COLUMNS)
    .eq("vehicle_id", vehicleId)
    .eq("owner_user_id", userId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false });

  if (error) throw error;
  return (data ?? []) as PassportListItem[];
}

export async function getPassport(
  vehicleId: string,
  passportId: string,
): Promise<VehiclePassport | null> {
  const supabase = await createClient();
  const userId = await getUserId(supabase);

  const { data, error } = await supabase
    .from("vehicle_passports")
    .select(PASSPORT_COLUMNS)
    .eq("id", passportId)
    .eq("vehicle_id", vehicleId)
    .eq("owner_user_id", userId)
    .is("deleted_at", null)
    .maybeSingle();

  if (error) throw error;
  return (data as VehiclePassport | null) ?? null;
}

/** Revoke an active passport and its transfer tokens. Snapshot is kept. */
export async function revokePassport(
  vehicleId: string,
  passportId: string,
): Promise<void> {
  const supabase = await createClient();
  const userId = await getUserId(supabase);

  const existing = await getPassport(vehicleId, passportId);
  if (!existing) throw new PassportNotFoundError();

  const { error: pErr } = await supabase
    .from("vehicle_passports")
    .update({ status: "revoked", revoked_at: new Date().toISOString() })
    .eq("id", passportId)
    .eq("owner_user_id", userId)
    .is("deleted_at", null);
  if (pErr) throw pErr;

  const { error: tErr } = await supabase
    .from("transfer_tokens")
    .update({ status: "revoked" })
    .eq("passport_id", passportId)
    .eq("owner_user_id", userId)
    .eq("status", "active");
  if (tErr) throw tErr;
}

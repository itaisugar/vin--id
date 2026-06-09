import "server-only";

import { createClient } from "@/lib/supabase/server";

/**
 * Server-only data export for the signed-in user (Phase 6G-lite).
 *
 * Every query uses the user's own RLS-scoped client, so a user can only ever
 * export their own rows. We additionally redact internal/sensitive fields:
 *  - `owner_user_id` is stripped from every row (internal).
 *  - `storage_path` is stripped from documents (private bucket path).
 *  - `transfer_tokens` (token_hash) and `app_events` are NOT exported at all.
 *  - `beta_feedback` is NOT exported (insert-only RLS — not readable by design).
 *
 * No raw files, no signed URLs, no token hashes, no service-role key.
 */

export class ExportNotAuthenticatedError extends Error {
  constructor() {
    super("Not authenticated");
    this.name = "ExportNotAuthenticatedError";
  }
}

type Row = Record<string, unknown>;

/** Remove given keys from every row (returns new objects). */
function strip(rows: Row[] | null | undefined, keys: string[]): Row[] {
  return (rows ?? []).map((row) => {
    const copy: Row = { ...row };
    for (const k of keys) delete copy[k];
    return copy;
  });
}

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new ExportNotAuthenticatedError();
  return { supabase, user };
}

const INTERNAL = ["owner_user_id"];

/**
 * Build the full JSON export payload for the current user. All collections are
 * scoped by RLS; sensitive columns are redacted before returning.
 */
export async function buildUserExport() {
  const { supabase, user } = await requireUser();

  const [
    profile,
    vehicles,
    maintenance,
    issues,
    documents,
    reminders,
    diagnosisSessions,
    diagnosisMessages,
    passports,
    transfers,
  ] = await Promise.all([
    supabase.from("profiles").select("*").maybeSingle(),
    supabase.from("vehicles").select("*"),
    supabase.from("maintenance_logs").select("*"),
    supabase.from("issue_logs").select("*"),
    supabase.from("vehicle_documents").select("*"),
    supabase.from("reminders").select("*"),
    supabase.from("diagnosis_sessions").select("*"),
    supabase.from("diagnosis_messages").select("*"),
    supabase.from("vehicle_passports").select("*"),
    supabase.from("ownership_transfers").select("*"),
  ]);

  return {
    meta: {
      app: "Vin.ID",
      kind: "account-export",
      version: 1,
      generated_at: new Date().toISOString(),
      user_id: user.id,
      email: user.email ?? null,
      notes:
        "Excludes original uploaded document files, storage paths, and Passport share tokens. Document entries are metadata only.",
    },
    profile: profile.data ? strip([profile.data], INTERNAL)[0] : null,
    vehicles: strip(vehicles.data, INTERNAL),
    maintenance_logs: strip(maintenance.data, INTERNAL),
    issue_logs: strip(issues.data, INTERNAL),
    // Documents: metadata only — storage_path (private bucket path) removed.
    vehicle_documents: strip(documents.data, [...INTERNAL, "storage_path"]),
    reminders: strip(reminders.data, INTERNAL),
    diagnosis_sessions: strip(diagnosisSessions.data, INTERNAL),
    diagnosis_messages: strip(diagnosisMessages.data, INTERNAL),
    // Passports include the frozen snapshot. No token hashes live on this table.
    vehicle_passports: strip(passports.data, INTERNAL),
    // RLS returns transfers where the user is seller or buyer.
    ownership_transfers: transfers.data ?? [],
  };
}

// -----------------------------------------------------------------------------
// CSV helpers
// -----------------------------------------------------------------------------
function csvCell(value: unknown): string {
  if (value == null) return "";
  const s = String(value);
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function toCsv(headers: string[], rows: (unknown[])[]): string {
  const lines = [headers.join(",")];
  for (const row of rows) lines.push(row.map(csvCell).join(","));
  // UTF-8 BOM so Excel renders Hebrew / accented text correctly.
  return "﻿" + lines.join("\r\n");
}

/** Map of vehicle id -> { make, model, year } for CSV joins. */
async function vehicleLookup(
  supabase: Awaited<ReturnType<typeof requireUser>>["supabase"],
) {
  const { data } = await supabase
    .from("vehicles")
    .select("id, make, model, year");
  const map = new Map<string, { make: unknown; model: unknown; year: unknown }>();
  for (const v of data ?? []) {
    map.set(v.id as string, { make: v.make, model: v.model, year: v.year });
  }
  return map;
}

/** Maintenance CSV (non-deleted), with vehicle make/model/year joined in. */
export async function buildMaintenanceCsv(): Promise<string> {
  const { supabase } = await requireUser();
  const vehicles = await vehicleLookup(supabase);

  const { data } = await supabase
    .from("maintenance_logs")
    .select(
      "vehicle_id, performed_at, mileage, service_type, description, cost, currency, trust_label, source_type, created_at",
    )
    .is("deleted_at", null)
    .order("performed_at", { ascending: false });

  const headers = [
    "vehicle_make",
    "vehicle_model",
    "vehicle_year",
    "date",
    "mileage",
    "category",
    "description",
    "cost",
    "currency",
    "trust_level",
    "source_type",
  ];

  const rows = (data ?? []).map((r) => {
    const v = vehicles.get(r.vehicle_id as string);
    return [
      v?.make ?? "",
      v?.model ?? "",
      v?.year ?? "",
      r.performed_at ?? "",
      r.mileage ?? "",
      r.service_type ?? "",
      r.description ?? "",
      r.cost ?? "",
      r.currency ?? "",
      r.trust_label ?? "",
      r.source_type ?? "",
    ];
  });

  return toCsv(headers, rows);
}

/** Issues CSV (non-deleted), with vehicle make/model/year joined in. */
export async function buildIssuesCsv(): Promise<string> {
  const { supabase } = await requireUser();
  const vehicles = await vehicleLookup(supabase);

  const { data } = await supabase
    .from("issue_logs")
    .select(
      "vehicle_id, reported_at, mileage, title, status, severity, resolution_notes, trust_label, source_type, created_at",
    )
    .is("deleted_at", null)
    .order("reported_at", { ascending: false });

  const headers = [
    "vehicle_make",
    "vehicle_model",
    "vehicle_year",
    "date",
    "mileage",
    "symptoms",
    "status",
    "severity",
    "resolution_notes",
    "trust_level",
    "source_type",
  ];

  const rows = (data ?? []).map((r) => {
    const v = vehicles.get(r.vehicle_id as string);
    return [
      v?.make ?? "",
      v?.model ?? "",
      v?.year ?? "",
      r.reported_at ?? "",
      r.mileage ?? "",
      r.title ?? "",
      r.status ?? "",
      r.severity ?? "",
      r.resolution_notes ?? "",
      r.trust_label ?? "",
      r.source_type ?? "",
    ];
  });

  return toCsv(headers, rows);
}

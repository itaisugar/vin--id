import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import {
  getVehicleById,
  NotAuthenticatedError,
} from "@/lib/vehicles/service";
import type { Vehicle } from "@/lib/vehicles/types";
import {
  ISSUE_COLUMNS,
  issueInputToRow,
  type IssueInput,
  type IssueLog,
} from "./types";

/**
 * Server-only data access for issue logs. Every call relies on Supabase RLS
 * (owner-scoped policies) AND additionally verifies ownership of both the
 * vehicle and the issue, plus filters out soft-deleted rows.
 */

export class VehicleNotFoundError extends Error {
  constructor() {
    super("Vehicle not found");
    this.name = "VehicleNotFoundError";
  }
}

export class IssueNotFoundError extends Error {
  constructor() {
    super("Issue not found");
    this.name = "IssueNotFoundError";
  }
}

async function getUserId(supabase: SupabaseClient): Promise<string> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new NotAuthenticatedError();
  return user.id;
}

/** Bump the vehicle's current_mileage upward only — never lowers it. */
async function maybeRaiseVehicleMileage(
  supabase: SupabaseClient,
  userId: string,
  vehicle: Vehicle,
  mileage: number | null | undefined,
): Promise<void> {
  if (mileage == null) return;
  if (vehicle.current_mileage != null && mileage <= vehicle.current_mileage) {
    return;
  }
  await supabase
    .from("vehicles")
    .update({ current_mileage: mileage })
    .eq("id", vehicle.id)
    .eq("owner_user_id", userId);
}

/** All non-deleted issues for a vehicle, newest reported date first. */
export async function listIssues(vehicleId: string): Promise<IssueLog[]> {
  const supabase = await createClient();
  const userId = await getUserId(supabase);

  const { data, error } = await supabase
    .from("issue_logs")
    .select(ISSUE_COLUMNS)
    .eq("vehicle_id", vehicleId)
    .eq("owner_user_id", userId)
    .is("deleted_at", null)
    .order("reported_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false });

  if (error) throw error;
  return (data ?? []) as IssueLog[];
}

/** A single non-deleted issue for a vehicle owned by the user, or null. */
export async function getIssue(
  vehicleId: string,
  issueId: string,
): Promise<IssueLog | null> {
  const supabase = await createClient();
  const userId = await getUserId(supabase);

  const { data, error } = await supabase
    .from("issue_logs")
    .select(ISSUE_COLUMNS)
    .eq("id", issueId)
    .eq("vehicle_id", vehicleId)
    .eq("owner_user_id", userId)
    .is("deleted_at", null)
    .maybeSingle();

  if (error) throw error;
  return (data as IssueLog | null) ?? null;
}

/**
 * Create an issue after verifying the vehicle belongs to the user. `sourceType`
 * defaults to "user"; callers that originate elsewhere (e.g. document scan) may
 * pass a different free-text origin label.
 */
export async function createIssue(
  vehicleId: string,
  input: IssueInput,
  sourceType: string = "user",
): Promise<string> {
  const supabase = await createClient();
  const userId = await getUserId(supabase);

  const vehicle = await getVehicleById(vehicleId);
  if (!vehicle) throw new VehicleNotFoundError();

  const resolvedAt =
    input.status === "resolved" ? new Date().toISOString() : null;

  const { data, error } = await supabase
    .from("issue_logs")
    .insert({
      ...issueInputToRow(input),
      resolved_at: resolvedAt,
      vehicle_id: vehicleId,
      owner_user_id: userId,
      source_type: sourceType,
    })
    .select("id")
    .single();

  if (error) throw error;

  await maybeRaiseVehicleMileage(supabase, userId, vehicle, input.mileage);
  return data.id as string;
}

/** Update an issue, verifying it belongs to this vehicle and user. */
export async function updateIssue(
  vehicleId: string,
  issueId: string,
  input: IssueInput,
): Promise<void> {
  const supabase = await createClient();
  const userId = await getUserId(supabase);

  const vehicle = await getVehicleById(vehicleId);
  if (!vehicle) throw new VehicleNotFoundError();

  const existing = await getIssue(vehicleId, issueId);
  if (!existing) throw new IssueNotFoundError();

  // Preserve the original resolved time while it stays resolved; clear it
  // when it is reopened.
  const resolvedAt =
    input.status === "resolved"
      ? (existing.resolved_at ?? new Date().toISOString())
      : null;

  const { error } = await supabase
    .from("issue_logs")
    .update({ ...issueInputToRow(input), resolved_at: resolvedAt })
    .eq("id", issueId)
    .eq("vehicle_id", vehicleId)
    .eq("owner_user_id", userId)
    .is("deleted_at", null);

  if (error) throw error;

  await maybeRaiseVehicleMileage(supabase, userId, vehicle, input.mileage);
}

/** Quick action: mark resolved, set resolved_at, optionally add notes. */
export async function resolveIssue(
  vehicleId: string,
  issueId: string,
  resolutionNotes?: string,
): Promise<void> {
  const supabase = await createClient();
  const userId = await getUserId(supabase);

  const existing = await getIssue(vehicleId, issueId);
  if (!existing) throw new IssueNotFoundError();

  const notes = resolutionNotes?.trim();
  const update: Record<string, unknown> = {
    status: "resolved",
    resolved_at: existing.resolved_at ?? new Date().toISOString(),
  };
  if (notes) update.resolution_notes = notes;

  const { error } = await supabase
    .from("issue_logs")
    .update(update)
    .eq("id", issueId)
    .eq("vehicle_id", vehicleId)
    .eq("owner_user_id", userId)
    .is("deleted_at", null);

  if (error) throw error;
}

/** Soft delete: set deleted_at. Never hard-deletes. */
export async function softDeleteIssue(
  vehicleId: string,
  issueId: string,
): Promise<void> {
  const supabase = await createClient();
  const userId = await getUserId(supabase);

  const { error } = await supabase
    .from("issue_logs")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", issueId)
    .eq("vehicle_id", vehicleId)
    .eq("owner_user_id", userId)
    .is("deleted_at", null);

  if (error) throw error;
}

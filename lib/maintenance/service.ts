import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import {
  getVehicleById,
  NotAuthenticatedError,
} from "@/lib/vehicles/service";
import type { Vehicle } from "@/lib/vehicles/types";
import {
  MAINTENANCE_COLUMNS,
  maintenanceInputToRow,
  type MaintenanceInput,
  type MaintenanceLog,
} from "./types";

/**
 * Server-only data access for maintenance logs. Every call relies on Supabase
 * RLS (owner-scoped policies) AND additionally verifies ownership of both the
 * vehicle and the log, plus filters out soft-deleted rows.
 */

export class VehicleNotFoundError extends Error {
  constructor() {
    super("Vehicle not found");
    this.name = "VehicleNotFoundError";
  }
}

export class MaintenanceNotFoundError extends Error {
  constructor() {
    super("Maintenance log not found");
    this.name = "MaintenanceNotFoundError";
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

/** All non-deleted logs for a vehicle, newest service date first. */
export async function listMaintenanceLogs(
  vehicleId: string,
): Promise<MaintenanceLog[]> {
  const supabase = await createClient();
  const userId = await getUserId(supabase);

  const { data, error } = await supabase
    .from("maintenance_logs")
    .select(MAINTENANCE_COLUMNS)
    .eq("vehicle_id", vehicleId)
    .eq("owner_user_id", userId)
    .is("deleted_at", null)
    .order("performed_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false });

  if (error) throw error;
  return (data ?? []) as MaintenanceLog[];
}

/** A single non-deleted log for a vehicle owned by the user, or null. */
export async function getMaintenanceLog(
  vehicleId: string,
  logId: string,
): Promise<MaintenanceLog | null> {
  const supabase = await createClient();
  const userId = await getUserId(supabase);

  const { data, error } = await supabase
    .from("maintenance_logs")
    .select(MAINTENANCE_COLUMNS)
    .eq("id", logId)
    .eq("vehicle_id", vehicleId)
    .eq("owner_user_id", userId)
    .is("deleted_at", null)
    .maybeSingle();

  if (error) throw error;
  return (data as MaintenanceLog | null) ?? null;
}

/**
 * Create a log after verifying the vehicle belongs to the user. `sourceType`
 * defaults to "user"; callers that originate elsewhere (e.g. document scan) may
 * pass a different free-text origin label.
 */
export async function createMaintenanceLog(
  vehicleId: string,
  input: MaintenanceInput,
  sourceType: string = "user",
): Promise<string> {
  const supabase = await createClient();
  const userId = await getUserId(supabase);

  // Ownership of the vehicle is enforced here (getVehicleById is owner-scoped).
  const vehicle = await getVehicleById(vehicleId);
  if (!vehicle) throw new VehicleNotFoundError();

  const { data, error } = await supabase
    .from("maintenance_logs")
    .insert({
      ...maintenanceInputToRow(input),
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

/** Update a log, verifying it belongs to this vehicle and user. */
export async function updateMaintenanceLog(
  vehicleId: string,
  logId: string,
  input: MaintenanceInput,
): Promise<void> {
  const supabase = await createClient();
  const userId = await getUserId(supabase);

  const vehicle = await getVehicleById(vehicleId);
  if (!vehicle) throw new VehicleNotFoundError();

  const existing = await getMaintenanceLog(vehicleId, logId);
  if (!existing) throw new MaintenanceNotFoundError();

  const { error } = await supabase
    .from("maintenance_logs")
    .update(maintenanceInputToRow(input))
    .eq("id", logId)
    .eq("vehicle_id", vehicleId)
    .eq("owner_user_id", userId)
    .is("deleted_at", null);

  if (error) throw error;

  await maybeRaiseVehicleMileage(supabase, userId, vehicle, input.mileage);
}

/** Soft delete: set deleted_at. Never hard-deletes. */
export async function softDeleteMaintenanceLog(
  vehicleId: string,
  logId: string,
): Promise<void> {
  const supabase = await createClient();
  const userId = await getUserId(supabase);

  const { error } = await supabase
    .from("maintenance_logs")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", logId)
    .eq("vehicle_id", vehicleId)
    .eq("owner_user_id", userId)
    .is("deleted_at", null);

  if (error) throw error;
}

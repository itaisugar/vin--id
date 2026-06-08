import "server-only";

import { createClient } from "@/lib/supabase/server";
import {
  VEHICLE_COLUMNS,
  vehicleInputToRow,
  type Vehicle,
  type VehicleInput,
} from "./types";

/**
 * Server-only data access for vehicles. Every call relies on Supabase RLS
 * (owner-scoped policies) AND additionally filters by owner_user_id /
 * deleted_at as defense in depth.
 */

export class NotAuthenticatedError extends Error {
  constructor() {
    super("Not authenticated");
    this.name = "NotAuthenticatedError";
  }
}

async function getUserId(): Promise<string> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new NotAuthenticatedError();
  return user.id;
}

/** All of the current user's non-deleted vehicles, newest first. */
export async function listVehicles(): Promise<Vehicle[]> {
  const supabase = await createClient();
  const userId = await getUserId();

  const { data, error } = await supabase
    .from("vehicles")
    .select(VEHICLE_COLUMNS)
    .eq("owner_user_id", userId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false });

  if (error) throw error;
  return (data ?? []) as Vehicle[];
}

/** A single vehicle owned by the current user, or null if not found. */
export async function getVehicleById(id: string): Promise<Vehicle | null> {
  const supabase = await createClient();
  const userId = await getUserId();

  const { data, error } = await supabase
    .from("vehicles")
    .select(VEHICLE_COLUMNS)
    .eq("id", id)
    .eq("owner_user_id", userId)
    .is("deleted_at", null)
    .maybeSingle();

  if (error) throw error;
  return (data as Vehicle | null) ?? null;
}

/** Insert a new vehicle for the current user. Returns the created id. */
export async function createVehicle(input: VehicleInput): Promise<string> {
  const supabase = await createClient();
  const userId = await getUserId();

  const { data, error } = await supabase
    .from("vehicles")
    .insert({ ...vehicleInputToRow(input), owner_user_id: userId })
    .select("id")
    .single();

  if (error) throw error;
  return data.id as string;
}

/** Update an existing vehicle owned by the current user. */
export async function updateVehicle(
  id: string,
  input: VehicleInput,
): Promise<void> {
  const supabase = await createClient();
  const userId = await getUserId();

  const { error } = await supabase
    .from("vehicles")
    .update(vehicleInputToRow(input))
    .eq("id", id)
    .eq("owner_user_id", userId)
    .is("deleted_at", null);

  if (error) throw error;
}

/** Soft archive: status='archived' + archived_at=now(). Never hard-deletes. */
export async function archiveVehicle(id: string): Promise<void> {
  const supabase = await createClient();
  const userId = await getUserId();

  const { error } = await supabase
    .from("vehicles")
    .update({ status: "archived", archived_at: new Date().toISOString() })
    .eq("id", id)
    .eq("owner_user_id", userId)
    .is("deleted_at", null);

  if (error) throw error;
}

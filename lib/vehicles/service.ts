import "server-only";

import { NotAuthenticatedError } from "@/lib/auth/errors";
import type { OperationalStatus } from "@/lib/fleet/types";
import {
  requireFleetWriter,
  requireOrganization,
} from "@/lib/organizations/service";
import { createClient } from "@/lib/supabase/server";
import {
  VEHICLE_COLUMNS,
  vehicleInputToRow,
  type Vehicle,
  type VehicleInput,
} from "./types";

/**
 * Server-only data access for vehicles.
 *
 * SCOPING (Fleet Lite): every query is scoped to the ORGANIZATION resolved from
 * the authenticated user's profile — no longer to `owner_user_id`. The
 * organization id is never accepted from the caller.
 *
 * Defense in depth: Supabase RLS already restricts rows to
 * `organization_id = public.current_org_id()`, and each query below ALSO adds
 * an explicit `.eq("organization_id", …)`. Either layer alone suffices; both
 * together mean an RLS regression cannot silently widen a query.
 *
 * Writes additionally go through `requireFleetWriter()`, so a `viewer` is
 * rejected in the app layer with a clear error rather than an opaque RLS denial.
 */

// Re-exported for the modules that already import it from here (maintenance,
// issues, documents, reminders, passports services).
export { NotAuthenticatedError };

export class VehicleNotFoundError extends Error {
  constructor() {
    super("Vehicle not found");
    this.name = "VehicleNotFoundError";
  }
}

/** All of the organization's non-deleted vehicles, newest first. */
export async function listVehicles(): Promise<Vehicle[]> {
  const supabase = await createClient();
  const { organizationId } = await requireOrganization();

  const { data, error } = await supabase
    .from("vehicles")
    .select(VEHICLE_COLUMNS)
    .eq("organization_id", organizationId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false });

  if (error) throw error;
  return (data ?? []) as Vehicle[];
}

/** A single vehicle in the current organization, or null if not found. */
export async function getVehicleById(id: string): Promise<Vehicle | null> {
  const supabase = await createClient();
  const { organizationId } = await requireOrganization();

  const { data, error } = await supabase
    .from("vehicles")
    .select(VEHICLE_COLUMNS)
    .eq("id", id)
    .eq("organization_id", organizationId)
    .is("deleted_at", null)
    .maybeSingle();

  if (error) throw error;
  return (data as Vehicle | null) ?? null;
}

/**
 * Insert a new vehicle for the current organization. Returns the created id.
 *
 * `organization_id` is intentionally NOT in the payload — the
 * `vehicles_set_organization_id` BEFORE INSERT trigger derives it from
 * `owner_user_id`, which makes a forged organization id in form input
 * impossible by construction.
 */
export async function createVehicle(input: VehicleInput): Promise<string> {
  const supabase = await createClient();
  const { userId } = await requireFleetWriter();

  const { data, error } = await supabase
    .from("vehicles")
    .insert({ ...vehicleInputToRow(input), owner_user_id: userId })
    .select("id")
    .single();

  if (error) throw error;
  return data.id as string;
}

/** Update a vehicle belonging to the current organization. */
export async function updateVehicle(
  id: string,
  input: VehicleInput,
): Promise<void> {
  const supabase = await createClient();
  const { organizationId } = await requireFleetWriter();

  const { error } = await supabase
    .from("vehicles")
    .update(vehicleInputToRow(input))
    .eq("id", id)
    .eq("organization_id", organizationId)
    .is("deleted_at", null);

  if (error) throw error;
}

/**
 * Update ONLY the operational status ("can this vehicle work today?").
 *
 * Separate from `updateVehicle` so the quick status control on the vehicle page
 * cannot accidentally clear the other fleet fields. `updated_at` is refreshed
 * by the existing `vehicles_set_updated_at` trigger.
 */
export async function setOperationalStatus(
  id: string,
  status: OperationalStatus,
): Promise<void> {
  const supabase = await createClient();
  const { organizationId } = await requireFleetWriter();

  const { data, error } = await supabase
    .from("vehicles")
    .update({ operational_status: status })
    .eq("id", id)
    .eq("organization_id", organizationId)
    .is("deleted_at", null)
    .select("id")
    .maybeSingle();

  if (error) throw error;
  // No row matched -> the vehicle is not in this organization (or is deleted).
  // Surface that instead of reporting a silent success.
  if (!data) throw new VehicleNotFoundError();
}

/** Soft archive: status='archived' + archived_at=now(). Never hard-deletes. */
export async function archiveVehicle(id: string): Promise<void> {
  const supabase = await createClient();
  const { organizationId } = await requireFleetWriter();

  const { error } = await supabase
    .from("vehicles")
    .update({ status: "archived", archived_at: new Date().toISOString() })
    .eq("id", id)
    .eq("organization_id", organizationId)
    .is("deleted_at", null);

  if (error) throw error;
}

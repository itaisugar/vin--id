import "server-only";

import { NotAuthenticatedError } from "@/lib/auth/errors";
import type { OperationalStatus } from "@/lib/fleet/types";
import {
  requireFleetWriter,
  requireOrganization,
} from "@/lib/organizations/service";
import { registrationDuplicateKey } from "@/lib/vehicle-lookup/normalize-registration";
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

/** A vehicle with the same registration number already exists in this workspace. */
export class DuplicateVehicleError extends Error {
  readonly existingId: string;
  constructor(existingId: string) {
    super("A vehicle with this registration number already exists");
    this.name = "DuplicateVehicleError";
    this.existingId = existingId;
  }
}

/** A matched existing vehicle (minimal shape for the duplicate warning). */
export interface ExistingVehicleMatch {
  id: string;
  make: string | null;
  model: string | null;
  license_plate: string | null;
}

/**
 * Find a non-deleted vehicle in the ACTIVE organization whose registration
 * number matches `plate` after normalization (spaces/hyphens/leading zeros are
 * ignored). Returns null when the plate has no usable digits or nothing matches.
 *
 * Organization-scoped by construction — it never sees another workspace's
 * vehicles, so it cannot disclose that the same plate exists elsewhere.
 */
export async function findVehicleByRegistration(
  plate: string | null | undefined,
): Promise<ExistingVehicleMatch | null> {
  const key = registrationDuplicateKey(plate);
  if (!key) return null;

  const supabase = await createClient();
  const { organizationId } = await requireOrganization();

  const { data, error } = await supabase
    .from("vehicles")
    .select("id, make, model, license_plate")
    .eq("organization_id", organizationId)
    .not("license_plate", "is", null)
    .is("deleted_at", null);

  if (error) throw error;
  const match = (data ?? []).find(
    (v) => registrationDuplicateKey(v.license_plate) === key,
  );
  return (match as ExistingVehicleMatch | undefined) ?? null;
}

/** Server-set source metadata for a created vehicle. Never taken from the form. */
export interface VehicleSourceMeta {
  data_source: "manual" | "israel_government";
  government_fetched_at: string | null;
  government_resource_id: string | null;
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
export async function createVehicle(
  input: VehicleInput,
  source?: VehicleSourceMeta,
): Promise<string> {
  const supabase = await createClient();
  const { userId } = await requireFleetWriter();

  // Workspace-scoped soft duplicate guard. A non-empty registration number that
  // already exists (ignoring spaces/hyphens/leading zeros) in this organization
  // blocks creation and reports the existing vehicle, so the UI can offer to open
  // it instead of silently creating a second copy. Null/blank plates are exempt.
  const existing = await findVehicleByRegistration(input.license_plate ?? null);
  if (existing) throw new DuplicateVehicleError(existing.id);

  // Source metadata is server-derived (never from the form). Only the known
  // `data_source` values are accepted; the resource id comes from server config
  // at the call site, not the client.
  const sourceRow = source
    ? {
        data_source: source.data_source,
        government_fetched_at: source.government_fetched_at,
        government_resource_id: source.government_resource_id,
      }
    : {};

  const { data, error } = await supabase
    .from("vehicles")
    .insert({ ...vehicleInputToRow(input), ...sourceRow, owner_user_id: userId })
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

import "server-only";

import {
  NotAuthorizedError,
  OrganizationMissingError,
} from "@/lib/auth/errors";
import { DOCUMENTS_BUCKET } from "@/lib/documents/types";
import {
  requireOrganization,
  requireOrganizationRole,
} from "@/lib/organizations/service";
import { ASSIGNMENT_MANAGER_ROLES } from "@/lib/organizations/types";
import { createClient } from "@/lib/supabase/server";
import {
  assignmentStateToError,
  type AssignmentActionResult,
  type AssignmentHistoryEntry,
  type CurrentAssignment,
  type DriverDocument,
  type DriverMaintenanceEntry,
  type DriverReminder,
  type DriverVehicle,
  type DriverViewData,
  type EligibleDriver,
} from "./types";

/**
 * Server-only data access for driver assignments and the Driver View.
 *
 * EVERY read below goes through a SECURITY DEFINER RPC rather than a table
 * query. That is not a style preference — it is the security design. RLS is
 * row-level, so any policy that let a driver read a maintenance or document ROW
 * would also hand them `cost` and `storage_path` through PostgREST, whatever
 * this file selects. The driver-facing tables are therefore closed outright and
 * the RPCs return explicit column lists. See
 * 20260725220000_driver_rls.sql and supabase/audits/driver_rls_audit.sql.
 *
 * None of these functions accepts a vehicle id from the client for driver
 * reads: the vehicle is resolved server-side from the caller's own active
 * assignment, so there is nothing to forge.
 */

// -----------------------------------------------------------------------------
// Driver side
// -----------------------------------------------------------------------------

/** The caller's actively assigned vehicle, or null when unassigned. */
export async function getMyDriverVehicle(): Promise<DriverVehicle | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_my_driver_vehicle");
  if (error) {
    console.error("[drivers] get_my_driver_vehicle failed:", { code: error.code });
    return null;
  }
  const rows = (data ?? []) as DriverVehicle[];
  return rows[0] ?? null;
}

/** Non-commercial service history for the caller's assigned vehicle. */
export async function getDriverMaintenanceHistory(
  limit = 10,
): Promise<DriverMaintenanceEntry[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_driver_maintenance_history", {
    p_limit: limit,
  });
  if (error) {
    console.error("[drivers] maintenance history failed:", { code: error.code });
    return [];
  }
  return (data ?? []) as DriverMaintenanceEntry[];
}

/** Documents a manager explicitly shared for the caller's assigned vehicle. */
export async function getDriverDocuments(): Promise<DriverDocument[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_driver_documents");
  if (error) {
    console.error("[drivers] documents failed:", { code: error.code });
    return [];
  }
  return (data ?? []) as DriverDocument[];
}

/** Reminders a manager explicitly shared for the caller's assigned vehicle. */
export async function getDriverReminders(): Promise<DriverReminder[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_driver_reminders");
  if (error) {
    console.error("[drivers] reminders failed:", { code: error.code });
    return [];
  }
  return (data ?? []) as DriverReminder[];
}

/**
 * Everything the Driver View needs. Returns null when the caller has no active
 * assignment, which the page renders as the explicit no-assignment state rather
 * than as an error.
 */
export async function getDriverViewData(): Promise<DriverViewData | null> {
  const vehicle = await getMyDriverVehicle();
  if (!vehicle) return null;

  const [maintenance, documents, reminders] = await Promise.all([
    getDriverMaintenanceHistory(),
    getDriverDocuments(),
    getDriverReminders(),
  ]);
  return { vehicle, maintenance, documents, reminders };
}

/**
 * A short-lived signed URL for a document shared with the calling driver.
 *
 * The Storage path is resolved by `get_driver_document_path()`, which re-applies
 * the whole driver rule (active assignment + driver_visible + not deleted). A
 * guessed document id, a document from another vehicle, or an unshared invoice
 * on the driver's OWN vehicle all resolve to NULL and no URL is signed. The path
 * never reaches the browser.
 */
export async function getDriverDocumentSignedUrl(
  documentId: string,
  expiresInSeconds = 300,
): Promise<string | null> {
  const supabase = await createClient();

  const { data: path, error } = await supabase.rpc("get_driver_document_path", {
    p_document: documentId,
  });
  if (error || !path) return null;

  const { data, error: signError } = await supabase.storage
    .from(DOCUMENTS_BUCKET)
    .createSignedUrl(path as string, expiresInSeconds);

  if (signError) return null;
  return data?.signedUrl ?? null;
}

// -----------------------------------------------------------------------------
// Manager side
// -----------------------------------------------------------------------------

/**
 * Members holding the `driver` role, for the assignment picker.
 *
 * Note the role set: owner/admin/fleet_manager. A fleet_manager may assign a
 * vehicle but may NOT invite or remove members — assignment rights and
 * membership rights are deliberately separate.
 */
export async function listEligibleDrivers(): Promise<EligibleDriver[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("list_eligible_drivers");
  if (error) {
    console.error("[drivers] list_eligible_drivers failed:", { code: error.code });
    return [];
  }
  return (data ?? []) as EligibleDriver[];
}

/** Full assignment history for one vehicle, newest first. */
export async function getVehicleAssignmentHistory(
  vehicleId: string,
): Promise<AssignmentHistoryEntry[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_vehicle_assignment_history", {
    p_vehicle: vehicleId,
  });
  if (error) {
    console.error("[drivers] assignment history failed:", { code: error.code });
    return [];
  }
  return (data ?? []) as AssignmentHistoryEntry[];
}

/** The vehicle's currently assigned driver, derived from its history. */
export async function getCurrentAssignment(
  vehicleId: string,
): Promise<CurrentAssignment | null> {
  const history = await getVehicleAssignmentHistory(vehicleId);
  const active = history.find((entry) => entry.unassigned_at === null);
  if (!active) return null;
  return {
    assignment_id: active.id,
    driver_name: active.driver_name,
    driver_email: active.driver_email,
    assigned_at: active.assigned_at,
  };
}

/**
 * Assign a driver to a vehicle, replacing whatever was active on either side.
 *
 * `assign_driver()` closes the vehicle's current assignment AND the driver's
 * current assignment before inserting, all in one transaction, so a reassignment
 * never transiently produces two active drivers for a vehicle or two active
 * vehicles for a driver. There is no separate "replace" call: assigning IS the
 * replace.
 */
export async function assignDriver(
  vehicleId: string,
  memberId: string,
  note?: string,
): Promise<AssignmentActionResult> {
  try {
    await requireOrganizationRole(ASSIGNMENT_MANAGER_ROLES);
  } catch (error) {
    if (
      error instanceof NotAuthorizedError ||
      error instanceof OrganizationMissingError
    ) {
      return { ok: false, error: "notAuthorized" };
    }
    throw error;
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("assign_driver", {
    p_vehicle: vehicleId,
    p_member: memberId,
    p_note: note?.trim() ? note.trim() : null,
  });

  if (error) {
    console.error("[drivers] assign_driver failed:", { code: error.code });
    return { ok: false, error: "saveFailed" };
  }
  const state = (data as { state?: string; assignment_id?: string } | null)?.state;
  if (state !== "ok") return { ok: false, error: assignmentStateToError(state) };

  return {
    ok: true,
    assignmentId: (data as { assignment_id?: string }).assignment_id,
  };
}

/** End the vehicle's active assignment. Idempotent: unassigning twice is fine. */
export async function unassignDriver(
  vehicleId: string,
): Promise<AssignmentActionResult> {
  try {
    await requireOrganizationRole(ASSIGNMENT_MANAGER_ROLES);
  } catch (error) {
    if (
      error instanceof NotAuthorizedError ||
      error instanceof OrganizationMissingError
    ) {
      return { ok: false, error: "notAuthorized" };
    }
    throw error;
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("unassign_driver", {
    p_vehicle: vehicleId,
  });

  if (error) {
    console.error("[drivers] unassign_driver failed:", { code: error.code });
    return { ok: false, error: "saveFailed" };
  }
  const state = (data as { state?: string } | null)?.state;
  if (state !== "ok") return { ok: false, error: assignmentStateToError(state) };
  return { ok: true };
}

/** True when the signed-in user holds the assigned-vehicle-only role. */
export async function isCurrentUserDriver(): Promise<boolean> {
  try {
    const { role } = await requireOrganization();
    return role === "driver";
  } catch {
    return false;
  }
}

/**
 * Driver assignment + Driver View types.
 *
 * THESE TYPES ARE NOT A SECURITY BOUNDARY. Every shape below mirrors the
 * explicit column list of a SECURITY DEFINER function in
 * 20260725220000_driver_rls.sql. The database is what withholds `cost`,
 * `storage_path` and friends; narrowing a TypeScript interface only stops the
 * app from *asking*. They are kept in lockstep deliberately so that a reviewer
 * reading the type sees the same field list the database returns.
 */

/** A driver's own vehicle, as returned by `get_my_driver_vehicle()`. */
export interface DriverVehicle {
  vehicle_id: string;
  nickname: string | null;
  make: string | null;
  model: string | null;
  year: number | null;
  license_plate: string | null;
  vin: string | null;
  color: string | null;
  vehicle_type: string | null;
  current_mileage: number | null;
  mileage_unit: string | null;
  photo_url: string | null;
  operational_status: string | null;
  next_service_date: string | null;
  next_service_km: number | null;
  test_expiry_date: string | null;
  insurance_expiry_date: string | null;
  assigned_at: string;
  organization_name: string;
}

/**
 * Service history for a driver. `cost`, `currency`, `vendor_name` and the
 * free-text `description` are absent by design — see the RPC comment.
 */
export interface DriverMaintenanceEntry {
  id: string;
  service_type: string | null;
  performed_at: string | null;
  mileage: number | null;
}

/**
 * A document a manager explicitly shared. Carries NO `storage_path`, `amount`,
 * `currency` or `vendor`: the id is the only handle, and it is exchanged for a
 * short-lived signed URL server-side.
 */
export interface DriverDocument {
  id: string;
  doc_type: string | null;
  title: string | null;
  file_name: string | null;
  mime_type: string | null;
  document_date: string | null;
  expiry_date: string | null;
  created_at: string;
}

/** A reminder a manager explicitly shared with the assigned driver. */
export interface DriverReminder {
  id: string;
  title: string;
  description: string | null;
  reminder_type: string | null;
  due_date: string | null;
  due_mileage: number | null;
  urgency: string | null;
  status: string | null;
}

/** Everything the Driver View renders, assembled server-side. */
export interface DriverViewData {
  vehicle: DriverVehicle;
  maintenance: DriverMaintenanceEntry[];
  documents: DriverDocument[];
  reminders: DriverReminder[];
}

// -----------------------------------------------------------------------------
// Manager side
// -----------------------------------------------------------------------------
/** A member holding the `driver` role, for the assignment picker. */
export interface EligibleDriver {
  member_id: string;
  user_id: string;
  email: string | null;
  full_name: string | null;
  /** Their current active assignment, if any — so the UI can warn about a move. */
  assigned_vehicle_id: string | null;
}

/** One row of a vehicle's assignment history. */
export interface AssignmentHistoryEntry {
  id: string;
  driver_name: string | null;
  driver_email: string | null;
  assigned_at: string;
  unassigned_at: string | null;
  note: string | null;
}

/** The currently assigned driver of a vehicle, as shown on the detail screen. */
export interface CurrentAssignment {
  assignment_id: string;
  driver_name: string | null;
  driver_email: string | null;
  assigned_at: string;
}

/**
 * Result states, mirroring the RPCs' `state` values one-for-one so the UI never
 * invents an error the database did not report.
 */
export type AssignmentErrorKey =
  | "notAuthenticated"
  | "notAuthorized"
  | "vehicleNotFound"
  | "memberNotFound"
  | "notADriver"
  | "saveFailed";

export type AssignmentActionResult =
  | { ok: true; assignmentId?: string }
  | { ok: false; error: AssignmentErrorKey };

/** Maps an RPC `state` string onto a translation key. */
export function assignmentStateToError(
  state: string | undefined,
): AssignmentErrorKey {
  switch (state) {
    case "not_authenticated":
      return "notAuthenticated";
    case "not_authorized":
      return "notAuthorized";
    case "vehicle_not_found":
      return "vehicleNotFound";
    case "member_not_found":
      return "memberNotFound";
    case "not_a_driver":
      return "notADriver";
    default:
      return "saveFailed";
  }
}

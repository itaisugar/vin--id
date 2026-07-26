"use server";

import { revalidatePath } from "next/cache";
import { assignDriver, unassignDriver } from "@/lib/drivers/service";
import type { AssignmentErrorKey } from "@/lib/drivers/types";

/**
 * Server actions for driver assignment.
 *
 * Authorization is NOT decided here. Both service calls re-check the caller's
 * role, and the underlying RPCs re-check it again server-side against
 * `can_manage_driver_assignments()` — a driver or viewer calling these directly
 * gets `not_authorized` from the database regardless of what the UI rendered.
 */
export type AssignmentActionState = { error?: AssignmentErrorKey };

export async function assignDriverAction(
  _prev: AssignmentActionState,
  formData: FormData,
): Promise<AssignmentActionState> {
  const vehicleId = String(formData.get("vehicleId") ?? "");
  const memberId = String(formData.get("memberId") ?? "");
  const note = String(formData.get("note") ?? "");

  if (!vehicleId || !memberId) return { error: "memberNotFound" };

  const result = await assignDriver(vehicleId, memberId, note);
  if (!result.ok) return { error: result.error };

  revalidatePath(`/vehicles/${vehicleId}`);
  return {};
}

export async function unassignDriverAction(
  _prev: AssignmentActionState,
  formData: FormData,
): Promise<AssignmentActionState> {
  const vehicleId = String(formData.get("vehicleId") ?? "");
  if (!vehicleId) return { error: "vehicleNotFound" };

  const result = await unassignDriver(vehicleId);
  if (!result.ok) return { error: result.error };

  revalidatePath(`/vehicles/${vehicleId}`);
  return {};
}

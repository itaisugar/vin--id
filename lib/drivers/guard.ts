import "server-only";

import { redirect } from "next/navigation";
import { getCurrentRole } from "@/lib/organizations/service";
import { isDriverRole } from "@/lib/organizations/types";

/**
 * Route guards for the driver role.
 *
 * THESE ARE NAVIGATION GUARDS, NOT SECURITY. A driver who ignores them and hits
 * a Fleet page directly still sees nothing, because every query underneath is
 * gated by RLS: the Fleet screens read tables that
 * 20260725220000_driver_rls.sql closes to drivers outright. What these do is
 * stop a driver being shown an empty, confusing Fleet dashboard when the app has
 * a purpose-built screen for them. Never rely on them to protect data.
 */

/** The driver's home screen. */
export const DRIVER_HOME = "/my-vehicle";

/** Fleet's home screen, for everyone else. */
export const FLEET_HOME = "/dashboard";

/**
 * Send drivers to their own screen. Call at the top of any Fleet-operations
 * page, whose queries would return nothing useful for a driver anyway.
 */
export async function redirectDriversAway(): Promise<void> {
  const role = await getCurrentRole();
  if (isDriverRole(role)) redirect(DRIVER_HOME);
}

/**
 * Restrict a page to drivers. Anyone else is sent to the Fleet dashboard, so
 * /my-vehicle never renders a half-empty screen for a manager who has no
 * assignment of their own.
 */
export async function requireDriverView(): Promise<void> {
  const role = await getCurrentRole();
  if (!isDriverRole(role)) redirect(FLEET_HOME);
}

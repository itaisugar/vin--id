"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import * as z from "zod";
import { trackEvent } from "@/lib/analytics/track";
import { NotAuthorizedError, OrganizationMissingError } from "@/lib/auth/errors";
import { OPERATIONAL_STATUSES } from "@/lib/fleet/types";
import {
  archiveVehicle,
  createVehicle,
  setOperationalStatus,
  updateVehicle,
  VehicleNotFoundError,
} from "@/lib/vehicles/service";
import { vehicleInputSchema } from "@/lib/vehicles/types";

/**
 * Result returned to the client form on failure. `fieldErrors`/`error` values
 * are translation keys (resolved under `vehicles.form.errors`). On success the
 * action redirects, so it never returns.
 */
export type VehicleActionState = {
  error?: string;
  fieldErrors?: Partial<Record<string, string>>;
};

/**
 * Map a thrown error to a translation key, without leaking database detail to
 * the user. Technical context is logged server-side only — never the row data
 * itself, and never anything user-identifying beyond the ids already in scope.
 */
function toActionError(error: unknown, fallback: string): VehicleActionState {
  if (error instanceof NotAuthorizedError) return { error: "notAuthorized" };
  if (error instanceof OrganizationMissingError) return { error: "noOrganization" };
  if (error instanceof VehicleNotFoundError) return { error: "notFound" };

  console.error("[vehicles] action failed:", {
    name: error instanceof Error ? error.name : "unknown",
    message: error instanceof Error ? error.message : String(error),
  });
  return { error: fallback };
}

function toFieldErrors(error: z.ZodError): VehicleActionState {
  const flattened = z.flattenError(error).fieldErrors as Record<
    string,
    string[] | undefined
  >;
  const fieldErrors: Record<string, string> = {};
  for (const [key, messages] of Object.entries(flattened)) {
    if (messages && messages.length > 0) fieldErrors[key] = messages[0];
  }
  return { fieldErrors };
}

export async function createVehicleAction(
  values: unknown,
): Promise<VehicleActionState> {
  const parsed = vehicleInputSchema.safeParse(values);
  if (!parsed.success) return toFieldErrors(parsed.error);

  let newId: string;
  try {
    newId = await createVehicle(parsed.data);
  } catch (error) {
    return toActionError(error, "saveFailed");
  }

  await trackEvent({
    eventName: "vehicle_created",
    entityType: "vehicle",
    entityId: newId,
    vehicleId: newId,
  });

  revalidatePath("/vehicles");
  redirect(`/vehicles/${newId}`);
}

export async function updateVehicleAction(
  id: string,
  values: unknown,
): Promise<VehicleActionState> {
  const parsed = vehicleInputSchema.safeParse(values);
  if (!parsed.success) return toFieldErrors(parsed.error);

  try {
    await updateVehicle(id, parsed.data);
  } catch (error) {
    return toActionError(error, "saveFailed");
  }

  revalidatePath("/vehicles");
  revalidatePath(`/vehicles/${id}`);
  redirect(`/vehicles/${id}`);
}

export async function archiveVehicleAction(
  id: string,
): Promise<VehicleActionState> {
  try {
    await archiveVehicle(id);
  } catch (error) {
    return toActionError(error, "archiveFailed");
  }

  revalidatePath("/vehicles");
  revalidatePath(`/vehicles/${id}`);
  redirect("/vehicles");
}

/**
 * Update a vehicle's OPERATIONAL status ("can this vehicle work today?").
 *
 * Authorization is enforced twice below the surface: `setOperationalStatus`
 * calls `requireFleetWriter()` (rejecting viewers), and the RLS update policy
 * additionally requires `public.is_org_writer()` plus an organization match.
 * The status value is validated against the enum here so an arbitrary string
 * from a tampered client can never reach the database.
 */
export async function setVehicleStatusAction(
  id: string,
  status: unknown,
): Promise<VehicleActionState> {
  const parsed = z.enum(OPERATIONAL_STATUSES).safeParse(status);
  if (!parsed.success) return { error: "invalidStatus" };

  try {
    await setOperationalStatus(id, parsed.data);
  } catch (error) {
    return toActionError(error, "saveFailed");
  }

  revalidatePath("/vehicles");
  revalidatePath(`/vehicles/${id}`);
  revalidatePath("/dashboard");
  return {};
}

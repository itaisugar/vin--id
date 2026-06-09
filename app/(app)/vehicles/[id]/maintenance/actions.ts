"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import * as z from "zod";
import { trackEvent } from "@/lib/analytics/track";
import {
  createMaintenanceLog,
  softDeleteMaintenanceLog,
  updateMaintenanceLog,
} from "@/lib/maintenance/service";
import { maintenanceInputSchema } from "@/lib/maintenance/types";

/**
 * Failure state returned to the client form. `fieldErrors`/`error` values are
 * translation keys (under `maintenance.form.errors`). On success, create/update
 * redirect (never return); delete returns undefined and relies on revalidation.
 */
export type MaintenanceActionState = {
  error?: string;
  fieldErrors?: Partial<Record<string, string>>;
};

function toFieldErrors(error: z.ZodError): MaintenanceActionState {
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

function revalidateVehicle(vehicleId: string) {
  revalidatePath(`/vehicles/${vehicleId}`);
  revalidatePath(`/vehicles/${vehicleId}/maintenance`);
}

export async function createMaintenanceAction(
  vehicleId: string,
  values: unknown,
): Promise<MaintenanceActionState> {
  const parsed = maintenanceInputSchema.safeParse(values);
  if (!parsed.success) return toFieldErrors(parsed.error);

  try {
    await createMaintenanceLog(vehicleId, parsed.data);
  } catch {
    return { error: "saveFailed" };
  }

  await trackEvent({
    eventName: "maintenance_created",
    entityType: "maintenance",
    vehicleId,
    metadata: { trust_label: parsed.data.trust_label },
  });

  revalidateVehicle(vehicleId);
  redirect(`/vehicles/${vehicleId}/maintenance`);
}

export async function updateMaintenanceAction(
  vehicleId: string,
  logId: string,
  values: unknown,
): Promise<MaintenanceActionState> {
  const parsed = maintenanceInputSchema.safeParse(values);
  if (!parsed.success) return toFieldErrors(parsed.error);

  try {
    await updateMaintenanceLog(vehicleId, logId, parsed.data);
  } catch {
    return { error: "saveFailed" };
  }

  revalidateVehicle(vehicleId);
  redirect(`/vehicles/${vehicleId}/maintenance`);
}

export async function deleteMaintenanceAction(
  vehicleId: string,
  logId: string,
): Promise<MaintenanceActionState> {
  try {
    await softDeleteMaintenanceLog(vehicleId, logId);
  } catch {
    return { error: "deleteFailed" };
  }

  // No redirect: revalidation refreshes whichever page triggered the delete.
  revalidateVehicle(vehicleId);
  return {};
}

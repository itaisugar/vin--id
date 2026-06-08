"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import * as z from "zod";
import {
  archiveVehicle,
  createVehicle,
  updateVehicle,
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
  } catch {
    return { error: "saveFailed" };
  }

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
  } catch {
    return { error: "saveFailed" };
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
  } catch {
    return { error: "archiveFailed" };
  }

  revalidatePath("/vehicles");
  revalidatePath(`/vehicles/${id}`);
  redirect("/vehicles");
}

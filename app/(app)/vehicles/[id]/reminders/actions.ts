"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import * as z from "zod";
import { trackEvent } from "@/lib/analytics/track";
import {
  createReminder,
  setReminderStatus,
  softDeleteReminder,
  updateReminder,
} from "@/lib/reminders/service";
import { reminderInputSchema } from "@/lib/reminders/types";

/**
 * Failure state returned to the client form. `fieldErrors`/`error` values are
 * translation keys (under `reminders.form.errors`). On success, create/update
 * redirect; the quick actions return undefined and rely on revalidation.
 */
export type ReminderActionState = {
  error?: string;
  fieldErrors?: Partial<Record<string, string>>;
};

function toFieldErrors(error: z.ZodError): ReminderActionState {
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

function revalidate(vehicleId: string) {
  revalidatePath(`/vehicles/${vehicleId}`);
  revalidatePath(`/vehicles/${vehicleId}/reminders`);
  revalidatePath("/dashboard");
}

export async function createReminderAction(
  vehicleId: string,
  values: unknown,
): Promise<ReminderActionState> {
  const parsed = reminderInputSchema.safeParse(values);
  if (!parsed.success) return toFieldErrors(parsed.error);

  try {
    await createReminder(vehicleId, parsed.data);
  } catch {
    return { error: "saveFailed" };
  }

  await trackEvent({
    eventName: "reminder_created",
    entityType: "reminder",
    vehicleId,
    metadata: {
      reminder_type: parsed.data.reminder_type,
      urgency: parsed.data.urgency,
    },
  });

  revalidate(vehicleId);
  redirect(`/vehicles/${vehicleId}/reminders`);
}

export async function updateReminderAction(
  vehicleId: string,
  reminderId: string,
  values: unknown,
): Promise<ReminderActionState> {
  const parsed = reminderInputSchema.safeParse(values);
  if (!parsed.success) return toFieldErrors(parsed.error);

  try {
    await updateReminder(vehicleId, reminderId, parsed.data);
  } catch {
    return { error: "saveFailed" };
  }

  revalidate(vehicleId);
  redirect(`/vehicles/${vehicleId}/reminders`);
}

export async function completeReminderAction(
  vehicleId: string,
  reminderId: string,
): Promise<ReminderActionState> {
  try {
    await setReminderStatus(vehicleId, reminderId, "completed");
  } catch {
    return { error: "actionFailed" };
  }
  revalidate(vehicleId);
  return {};
}

export async function dismissReminderAction(
  vehicleId: string,
  reminderId: string,
): Promise<ReminderActionState> {
  try {
    await setReminderStatus(vehicleId, reminderId, "dismissed");
  } catch {
    return { error: "actionFailed" };
  }
  revalidate(vehicleId);
  return {};
}

export async function deleteReminderAction(
  vehicleId: string,
  reminderId: string,
): Promise<ReminderActionState> {
  try {
    await softDeleteReminder(vehicleId, reminderId);
  } catch {
    return { error: "deleteFailed" };
  }
  revalidate(vehicleId);
  return {};
}

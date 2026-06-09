"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import * as z from "zod";
import { trackEvent } from "@/lib/analytics/track";
import {
  createIssue,
  resolveIssue,
  softDeleteIssue,
  updateIssue,
} from "@/lib/issues/service";
import { issueInputSchema } from "@/lib/issues/types";

/**
 * Failure state returned to the client form. `fieldErrors`/`error` values are
 * translation keys (under `issues.form.errors`). On success, create/update
 * redirect; resolve/delete return undefined and rely on revalidation.
 */
export type IssueActionState = {
  error?: string;
  fieldErrors?: Partial<Record<string, string>>;
};

function toFieldErrors(error: z.ZodError): IssueActionState {
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
  revalidatePath(`/vehicles/${vehicleId}/issues`);
}

export async function createIssueAction(
  vehicleId: string,
  values: unknown,
): Promise<IssueActionState> {
  const parsed = issueInputSchema.safeParse(values);
  if (!parsed.success) return toFieldErrors(parsed.error);

  try {
    await createIssue(vehicleId, parsed.data);
  } catch {
    return { error: "saveFailed" };
  }

  await trackEvent({
    eventName: "issue_created",
    entityType: "issue",
    vehicleId,
    metadata: { severity: parsed.data.severity, status: parsed.data.status },
  });

  revalidateVehicle(vehicleId);
  redirect(`/vehicles/${vehicleId}/issues`);
}

export async function updateIssueAction(
  vehicleId: string,
  issueId: string,
  values: unknown,
): Promise<IssueActionState> {
  const parsed = issueInputSchema.safeParse(values);
  if (!parsed.success) return toFieldErrors(parsed.error);

  try {
    await updateIssue(vehicleId, issueId, parsed.data);
  } catch {
    return { error: "saveFailed" };
  }

  revalidateVehicle(vehicleId);
  redirect(`/vehicles/${vehicleId}/issues`);
}

export async function resolveIssueAction(
  vehicleId: string,
  issueId: string,
  resolutionNotes?: string,
): Promise<IssueActionState> {
  try {
    await resolveIssue(vehicleId, issueId, resolutionNotes);
  } catch {
    return { error: "resolveFailed" };
  }

  revalidateVehicle(vehicleId);
  return {};
}

export async function deleteIssueAction(
  vehicleId: string,
  issueId: string,
): Promise<IssueActionState> {
  try {
    await softDeleteIssue(vehicleId, issueId);
  } catch {
    return { error: "deleteFailed" };
  }

  revalidateVehicle(vehicleId);
  return {};
}

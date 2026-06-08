"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getLocale } from "next-intl/server";
import * as z from "zod";
import {
  createDiagnosis,
  saveSessionAsIssue,
} from "@/lib/diagnosis/service";
import { diagnosisInputSchema } from "@/lib/diagnosis/types";

/**
 * Failure state for diagnosis actions. `fieldErrors`/`error` are translation
 * keys (under `diagnose.form.errors`). On success the actions redirect.
 */
export type DiagnosisActionState = {
  error?: string;
  fieldErrors?: Partial<Record<string, string>>;
};

function toFieldErrors(error: z.ZodError): DiagnosisActionState {
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

export async function createDiagnosisAction(
  values: unknown,
): Promise<DiagnosisActionState> {
  const parsed = diagnosisInputSchema.safeParse(values);
  if (!parsed.success) return toFieldErrors(parsed.error);

  const locale = await getLocale();
  let sessionId: string;
  try {
    sessionId = await createDiagnosis(parsed.data, locale);
  } catch {
    return { error: "diagnoseFailed" };
  }

  revalidatePath("/diagnose");
  redirect(`/diagnose/${sessionId}`);
}

export async function saveAsIssueAction(
  sessionId: string,
): Promise<DiagnosisActionState> {
  let vehicleId: string;
  try {
    vehicleId = await saveSessionAsIssue(sessionId);
  } catch {
    return { error: "saveIssueFailed" };
  }

  revalidatePath(`/vehicles/${vehicleId}`);
  revalidatePath(`/vehicles/${vehicleId}/issues`);
  redirect(`/vehicles/${vehicleId}/issues`);
}

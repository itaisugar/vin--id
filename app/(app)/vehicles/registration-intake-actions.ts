"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getLocale } from "next-intl/server";
import { trackEvent } from "@/lib/analytics/track";
import {
  cancelRegistrationIntake,
  confirmRegistrationIntake,
  createRegistrationIntake,
  type ConfirmRegistrationInput,
  type IntakeErrorKey,
} from "@/lib/vehicle-intake/service";
import type { VehicleRegistrationExtraction } from "@/lib/vehicle-intake/extraction-types";

/**
 * Server actions for vehicle-registration AI intake.
 *
 * Uploading and extracting are inert (they stage a file + a reviewable row).
 * Only `confirmRegistrationIntakeAction` creates a vehicle, through the atomic
 * `confirm_vehicle_registration_intake()` RPC. Every action is authenticated and
 * checks the Fleet-writer permission in the service and again in the database.
 */

export type CreateIntakeState =
  | { ok: true; intakeId: string; extraction: VehicleRegistrationExtraction; engine: string }
  | { ok: false; error: IntakeErrorKey };

export async function createRegistrationIntakeAction(
  formData: FormData,
): Promise<CreateIntakeState> {
  const file = formData.get("file");
  const locale = await getLocale();
  const result = await createRegistrationIntake(file, locale);

  await trackEvent({
    eventName: "vehicle_registration_intake",
    entityType: "vehicle",
    metadata: {
      status: result.ok ? "extracted" : "failed",
      documentType: result.ok ? result.extraction.document_type : undefined,
      engine: result.ok ? result.engine : undefined,
    },
  });

  return result;
}

export type ConfirmIntakeState = { error?: string; duplicateId?: string };

export async function confirmRegistrationIntakeAction(
  input: ConfirmRegistrationInput,
): Promise<ConfirmIntakeState> {
  const result = await confirmRegistrationIntake(input);
  if (!result.ok) {
    if (result.error === "duplicate") {
      return { error: "duplicate", duplicateId: result.existingVehicleId };
    }
    // Map RPC/service states to the vehicle form's known error keys so the
    // reused VehicleForm always resolves a translation.
    const map: Record<string, string> = {
      not_authenticated: "notAuthorized",
      not_authorized: "notAuthorized",
      notAuthorized: "notAuthorized",
      extraction_not_found: "notFound",
      invalid_payload: "saveFailed",
      invalid_source: "saveFailed",
      stale: "saveFailed",
      saveFailed: "saveFailed",
    };
    return { error: map[result.error] ?? "saveFailed" };
  }

  await trackEvent({
    eventName: "vehicle_created",
    entityType: "vehicle",
    entityId: result.vehicleId,
    vehicleId: result.vehicleId,
    metadata: { dataSource: input.usedGovernment ? "mixed_confirmed" : "vehicle_registration_ai" },
  });

  revalidatePath("/vehicles");
  redirect(`/vehicles/${result.vehicleId}`);
}

export async function cancelRegistrationIntakeAction(intakeId: string): Promise<boolean> {
  if (typeof intakeId !== "string" || intakeId === "") return false;
  return cancelRegistrationIntake(intakeId);
}

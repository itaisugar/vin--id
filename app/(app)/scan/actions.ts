"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getLocale } from "next-intl/server";
import * as z from "zod";
import { trackEvent } from "@/lib/analytics/track";
import { createMaintenanceLog } from "@/lib/maintenance/service";
import { maintenanceInputSchema } from "@/lib/maintenance/types";
import { createIssue } from "@/lib/issues/service";
import { issueInputSchema } from "@/lib/issues/types";
import {
  createInsurance,
  createRegistration,
  createInspection,
} from "@/lib/vehicle-records/service";
import {
  insuranceInputSchema,
  registrationInputSchema,
  inspectionInputSchema,
} from "@/lib/vehicle-records/types";
import {
  extractFromScan,
  VehicleNotFoundError,
} from "@/lib/documents/scan/service";
import {
  isScanImageMime,
  MAX_SCAN_FILE_SIZE,
  SCAN_FORM_CATEGORIES,
  type ScanConfirmFormValues,
  type ScanExtractionResponse,
  type ScanFormCategory,
} from "@/lib/documents/scan/types";

/**
 * Server actions for the "Scan a document" flow.
 *
 * `scanExtractAction` runs the (server-side) extraction and returns a pre-fill
 * for the confirmation screen — NOTHING is saved. `createRecordFromScanAction`
 * runs only after the user confirms, and creates the record through the EXISTING
 * maintenance/issue create flow (same Zod schema, same mileage-bump logic).
 */

export type ScanExtractState =
  | { ok: true; response: ScanExtractionResponse }
  | { ok: false; error: string };

export type ScanCreateState = {
  error?: string;
  fieldErrors?: Partial<Record<string, string>>;
};

function toFieldErrors(error: z.ZodError): Record<string, string> {
  const flattened = z.flattenError(error).fieldErrors as Record<
    string,
    string[] | undefined
  >;
  const fieldErrors: Record<string, string> = {};
  for (const [key, messages] of Object.entries(flattened)) {
    if (messages && messages.length > 0) fieldErrors[key] = messages[0];
  }
  return fieldErrors;
}

/**
 * Send a scanned image to the extraction provider (server-side) and return the
 * structured pre-fill. The image is processed in memory and never stored. The
 * consent flag is enforced here as a backstop to the UI consent notice.
 */
export async function scanExtractAction(
  formData: FormData,
): Promise<ScanExtractState> {
  const vehicleId = String(formData.get("vehicleId") ?? "");
  const consent = formData.get("consent") === "true";
  const file = formData.get("file");

  if (!vehicleId) return { ok: false, error: "vehicleRequired" };
  if (!consent) return { ok: false, error: "consentRequired" };
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: "fileRequired" };
  }
  if (file.type === "application/pdf") {
    return { ok: false, error: "pdfNotSupported" };
  }
  if (!isScanImageMime(file.type)) {
    return { ok: false, error: "invalidFileType" };
  }
  if (file.size > MAX_SCAN_FILE_SIZE) {
    return { ok: false, error: "fileTooLarge" };
  }

  const locale = await getLocale();

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const response = await extractFromScan(
      vehicleId,
      { buffer, mimeType: file.type },
      locale,
    );

    // Best-effort, privacy-safe event (no document content — counts/flags only).
    await trackEvent({
      eventName: "document_scan_extracted",
      entityType: "document_scan",
      vehicleId,
      metadata: {
        engine: response.engine,
        guess: response.extraction.document_category,
      },
    });

    return { ok: true, response };
  } catch (err) {
    if (err instanceof VehicleNotFoundError) {
      return { ok: false, error: "vehicleNotFound" };
    }
    // Provider/transport/decode failure → caller falls back to manual entry.
    return { ok: false, error: "extractFailed" };
  }
}

/**
 * Create the confirmed record. `values` is the editable confirmation form;
 * `trust_label` is forced server-side to `ai_extracted` (extracted from a
 * document, user-confirmed) and `source_type` to `document_scan`. Maintenance
 * and issue reuse the existing create flows unchanged; insurance / registration
 * / inspection insert into their owner-scoped tables (ownership re-verified in
 * the service). On success this redirects and never returns.
 */
export async function createRecordFromScanAction(
  vehicleId: string,
  category: ScanFormCategory,
  values: ScanConfirmFormValues,
): Promise<ScanCreateState> {
  if (!vehicleId) return { error: "saveFailed" };
  if (!(SCAN_FORM_CATEGORIES as readonly string[]).includes(category)) {
    return { error: "saveFailed" };
  }

  if (category === "maintenance") {
    // The garage name has no dedicated maintenance column; fold it into the
    // description so the extracted value is preserved and editable.
    const garage = values.garage_name.trim();
    const details = values.description.trim();
    const description =
      garage && details
        ? `${details} (${garage})`
        : details || garage;

    const parsed = maintenanceInputSchema.safeParse({
      date: values.date,
      mileage: values.mileage,
      category: values.service_type,
      description,
      cost: values.cost,
      currency: values.currency,
      trust_label: "ai_extracted",
    });
    if (!parsed.success) return { fieldErrors: toFieldErrors(parsed.error) };

    try {
      await createMaintenanceLog(vehicleId, parsed.data, "document_scan");
    } catch {
      return { error: "saveFailed" };
    }

    await trackEvent({
      eventName: "maintenance_created",
      entityType: "maintenance",
      vehicleId,
      metadata: { trust_label: parsed.data.trust_label, source: "scan" },
    });

    revalidatePath(`/vehicles/${vehicleId}`);
    revalidatePath(`/vehicles/${vehicleId}/maintenance`);
    redirect(`/vehicles/${vehicleId}/maintenance`);
  }

  if (category === "issue") {
    const parsed = issueInputSchema.safeParse({
      date: values.date,
      mileage: values.mileage,
      symptoms: values.description,
      severity: values.severity,
      status: values.status,
      trust_label: "ai_extracted",
    });
    if (!parsed.success) {
      const fieldErrors = toFieldErrors(parsed.error);
      // The form binds the symptoms input to `description`; remap so the error
      // shows on the right field.
      if (fieldErrors.symptoms) {
        fieldErrors.description = fieldErrors.symptoms;
        delete fieldErrors.symptoms;
      }
      return { fieldErrors };
    }

    try {
      await createIssue(vehicleId, parsed.data, "document_scan");
    } catch {
      return { error: "saveFailed" };
    }

    await trackEvent({
      eventName: "issue_created",
      entityType: "issue",
      vehicleId,
      metadata: {
        severity: parsed.data.severity,
        status: parsed.data.status,
        source: "scan",
      },
    });

    revalidatePath(`/vehicles/${vehicleId}`);
    revalidatePath(`/vehicles/${vehicleId}/issues`);
    redirect(`/vehicles/${vehicleId}/issues`);
  }

  if (category === "insurance") {
    const parsed = insuranceInputSchema.safeParse({
      insurer_name: values.insurer_name,
      start_date: values.start_date,
      end_date: values.end_date,
      cost: values.cost,
      insurance_type: values.insurance_type,
      trust_label: "ai_extracted",
    });
    if (!parsed.success) return { fieldErrors: toFieldErrors(parsed.error) };

    try {
      await createInsurance(vehicleId, parsed.data, "document_scan");
    } catch {
      return { error: "saveFailed" };
    }

    await trackEvent({
      eventName: "insurance_created",
      entityType: "vehicle_insurance",
      vehicleId,
      metadata: { trust_label: parsed.data.trust_label, source: "scan" },
    });

    revalidatePath(`/vehicles/${vehicleId}`);
    redirect(`/vehicles/${vehicleId}`);
  }

  if (category === "registration") {
    const parsed = registrationInputSchema.safeParse({
      start_date: values.start_date,
      end_date: values.end_date,
      mileage: values.mileage,
      notes: values.notes,
      trust_label: "ai_extracted",
    });
    if (!parsed.success) return { fieldErrors: toFieldErrors(parsed.error) };

    try {
      await createRegistration(vehicleId, parsed.data, "document_scan");
    } catch {
      return { error: "saveFailed" };
    }

    await trackEvent({
      eventName: "registration_created",
      entityType: "vehicle_registration",
      vehicleId,
      metadata: { trust_label: parsed.data.trust_label, source: "scan" },
    });

    revalidatePath(`/vehicles/${vehicleId}`);
    redirect(`/vehicles/${vehicleId}`);
  }

  // inspection
  const parsed = inspectionInputSchema.safeParse({
    start_date: values.start_date,
    end_date: values.end_date,
    mileage: values.mileage,
    cost: values.cost,
    notes: values.notes,
    trust_label: "ai_extracted",
  });
  if (!parsed.success) return { fieldErrors: toFieldErrors(parsed.error) };

  try {
    await createInspection(vehicleId, parsed.data, "document_scan");
  } catch {
    return { error: "saveFailed" };
  }

  await trackEvent({
    eventName: "inspection_created",
    entityType: "vehicle_inspection",
    vehicleId,
    metadata: { trust_label: parsed.data.trust_label, source: "scan" },
  });

  revalidatePath(`/vehicles/${vehicleId}`);
  redirect(`/vehicles/${vehicleId}`);
}

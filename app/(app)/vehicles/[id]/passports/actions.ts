"use server";

import { revalidatePath } from "next/cache";
import { trackEvent } from "@/lib/analytics/track";
import { createPassport, revokePassport } from "@/lib/passports/service";
import { passportOptionsSchema } from "@/lib/passports/types";

/**
 * Failure/success state for passport actions. `error` values are translation
 * keys (under `passports.errors`). On successful create we DO NOT redirect — we
 * return the one-time `shareUrl` so the client can show it once.
 */
export type PassportActionState = {
  error?: string;
  passportId?: string;
  /** One-time share URL. `null` when the app's public URL is misconfigured. */
  shareUrl?: string | null;
};

function revalidate(vehicleId: string, passportId?: string) {
  revalidatePath(`/vehicles/${vehicleId}`);
  revalidatePath(`/vehicles/${vehicleId}/passports`);
  if (passportId) {
    revalidatePath(`/vehicles/${vehicleId}/passports/${passportId}`);
  }
}

export async function createPassportAction(
  vehicleId: string,
  values: unknown,
): Promise<PassportActionState> {
  const parsed = passportOptionsSchema.safeParse(values);
  if (!parsed.success) return { error: "invalidOptions" };

  try {
    const { passportId, shareUrl } = await createPassport(
      vehicleId,
      parsed.data,
    );

    const o = parsed.data;
    await trackEvent({
      eventName: "passport_created",
      entityType: "passport",
      entityId: passportId,
      vehicleId,
      passportId,
      metadata: {
        included_scopes_count: [
          o.includeMaintenance,
          o.includeIssues,
          o.includeDocuments,
          o.includeReminders,
        ].filter(Boolean).length,
        include_personal_docs: o.includePersonalDocs,
      },
    });

    revalidate(vehicleId, passportId);
    return { passportId, shareUrl };
  } catch {
    return { error: "createFailed" };
  }
}

export async function revokePassportAction(
  vehicleId: string,
  passportId: string,
): Promise<PassportActionState> {
  try {
    await revokePassport(vehicleId, passportId);
  } catch {
    return { error: "revokeFailed" };
  }
  revalidate(vehicleId, passportId);
  return {};
}

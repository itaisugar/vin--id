"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import * as z from "zod";
import { trackEvent } from "@/lib/analytics/track";
import { NotAuthenticatedError, NotAuthorizedError, OrganizationMissingError } from "@/lib/auth/errors";
import { OPERATIONAL_STATUSES } from "@/lib/fleet/types";
import { requireFleetWriter } from "@/lib/organizations/service";
import {
  archiveVehicle,
  createVehicle,
  DuplicateVehicleError,
  findVehicleByRegistration,
  setOperationalStatus,
  updateVehicle,
  VehicleNotFoundError,
  type ExistingVehicleMatch,
  type VehicleSourceMeta,
} from "@/lib/vehicles/service";
import { vehicleInputSchema } from "@/lib/vehicles/types";
import { getVehicleLookupConfig } from "@/lib/vehicle-lookup/config";
import { lookupVehicle } from "@/lib/vehicle-lookup/service";
import type { VehicleLookupResult } from "@/lib/vehicle-lookup/types";

/**
 * Result returned to the client form on failure. `fieldErrors`/`error` values
 * are translation keys (resolved under `vehicles.form.errors`). On success the
 * action redirects, so it never returns.
 */
export type VehicleActionState = {
  error?: string;
  fieldErrors?: Partial<Record<string, string>>;
  /** When `error === "duplicate"`, the existing vehicle to offer opening. */
  duplicateId?: string;
};

/** Result of a government lookup: the typed contract + a workspace dup match. */
export type VehicleLookupActionState = {
  result: VehicleLookupResult;
  /** An existing vehicle in THIS workspace with the same plate, if any. */
  duplicate?: ExistingVehicleMatch | null;
};

/**
 * Government vehicle lookup (read-only).
 *
 * Authorization mirrors vehicle creation: `requireFleetWriter()` — a user who
 * may create a vehicle in the active workspace may look one up; a viewer/driver
 * is denied. It writes nothing, creates no reminder, and returns only the
 * mapped contract plus an organization-scoped duplicate hint. Raw provider
 * errors never leave the service; they arrive here as stable `unavailable`
 * states. Logs carry the status only — never the registration number.
 */
export async function lookupVehicleAction(
  registration: unknown,
): Promise<VehicleLookupActionState> {
  // Authenticated, create-capable users only.
  try {
    await requireFleetWriter();
  } catch (error) {
    if (
      error instanceof NotAuthorizedError ||
      error instanceof OrganizationMissingError ||
      error instanceof NotAuthenticatedError
    ) {
      return {
        result: { status: "unavailable", source: "israel_government", retryable: false, reason: "configuration" },
      };
    }
    throw error;
  }

  const reg = typeof registration === "string" ? registration : "";
  const result = await lookupVehicle(reg);

  await trackEvent({
    eventName: "vehicle_lookup",
    entityType: "vehicle",
    metadata: {
      status: result.status,
      retryable: result.status === "unavailable" ? result.retryable : undefined,
    },
  });

  // Only a found result needs a duplicate hint. The check is org-scoped, so it
  // can never disclose that the plate exists in another workspace.
  let duplicate: ExistingVehicleMatch | null = null;
  if (result.status === "found") {
    duplicate = await findVehicleByRegistration(result.vehicle.registration_number);
  }

  return { result, duplicate };
}

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

/**
 * Client-supplied lookup provenance. Deliberately minimal: only the source flag
 * and the fetch timestamp are trusted from the client, and the source is checked
 * against a fixed allowlist. The resource id is NEVER taken from the client — it
 * is re-derived from server config below.
 */
export type CreateVehicleLookupMeta = {
  source: "israel_government";
  fetchedAt?: string;
};

/**
 * Build server-trusted source metadata. Unknown source values are ignored
 * (treated as manual). The resource id comes from configuration, not the client.
 */
function resolveSourceMeta(
  meta: CreateVehicleLookupMeta | undefined,
): VehicleSourceMeta | undefined {
  if (!meta || meta.source !== "israel_government") return undefined;
  const fetchedAt =
    typeof meta.fetchedAt === "string" && !Number.isNaN(Date.parse(meta.fetchedAt))
      ? meta.fetchedAt
      : new Date().toISOString();
  let resourceId: string | null = null;
  try {
    resourceId = getVehicleLookupConfig().resourceId;
  } catch {
    resourceId = null; // config trouble is non-fatal for recording provenance
  }
  return {
    data_source: "israel_government",
    government_fetched_at: fetchedAt,
    government_resource_id: resourceId,
  };
}

export async function createVehicleAction(
  values: unknown,
  lookupMeta?: CreateVehicleLookupMeta,
): Promise<VehicleActionState> {
  const parsed = vehicleInputSchema.safeParse(values);
  if (!parsed.success) return toFieldErrors(parsed.error);

  let newId: string;
  try {
    newId = await createVehicle(parsed.data, resolveSourceMeta(lookupMeta));
  } catch (error) {
    // A same-workspace duplicate is a first-class, user-facing state, not a
    // generic failure — return the existing id so the UI can offer to open it.
    if (error instanceof DuplicateVehicleError) {
      return { error: "duplicate", duplicateId: error.existingId };
    }
    return toActionError(error, "saveFailed");
  }

  await trackEvent({
    eventName: "vehicle_created",
    entityType: "vehicle",
    entityId: newId,
    vehicleId: newId,
    metadata: { dataSource: lookupMeta?.source === "israel_government" ? "israel_government" : "manual" },
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

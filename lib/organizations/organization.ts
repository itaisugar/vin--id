import "server-only";

import * as z from "zod";
import { createClient } from "@/lib/supabase/server";

/**
 * Explicit Business organization creation.
 *
 * The whole operation lives in the `create_business_organization()` RPC — a
 * SECURITY DEFINER function that creates the organization, the owner membership
 * and the active-workspace pointer in ONE transaction, deriving the owner from
 * `auth.uid()`. This layer never supplies an owner id, never inserts the
 * organization or membership directly, and never trusts a client-chosen id: it
 * validates the name, calls the RPC, and maps its stable states to error keys.
 *
 * Creating a business organization moves NO data — the caller's personal
 * workspace and every vehicle in it are untouched. The new organization simply
 * becomes the active one.
 */

/** Only the name is owned by the UI. Everything else is derived server-side. */
export const createOrganizationInputSchema = z.object({
  name: z
    .string({ error: "required" })
    .trim()
    .min(1, { error: "required" })
    .max(120, { error: "tooLong" }),
});

export type CreateOrganizationInput = z.infer<
  typeof createOrganizationInputSchema
>;

/** Translation keys under `organization.activation.errors`. */
export type CreateOrganizationErrorKey =
  | "required"
  | "tooLong"
  | "invalidName"
  | "notAuthenticated"
  | "noProfile"
  | "saveFailed";

export type CreateOrganizationResult =
  | { ok: true; organizationId: string }
  | { ok: false; error: CreateOrganizationErrorKey };

export async function createBusinessOrganization(
  values: unknown,
): Promise<CreateOrganizationResult> {
  const parsed = createOrganizationInputSchema.safeParse(values);
  if (!parsed.success) {
    const fieldErrors = z.flattenError(parsed.error).fieldErrors as Record<
      string,
      string[] | undefined
    >;
    return {
      ok: false,
      error: (fieldErrors.name?.[0] ?? "saveFailed") as CreateOrganizationErrorKey,
    };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_business_organization", {
    p_name: parsed.data.name,
  });

  if (error) {
    console.error("[organizations] createBusinessOrganization failed:", {
      code: error.code,
    });
    return { ok: false, error: "saveFailed" };
  }

  const result = (data ?? {}) as { state?: string; organization_id?: string };
  switch (result.state) {
    case "ok":
      return result.organization_id
        ? { ok: true, organizationId: result.organization_id }
        : { ok: false, error: "saveFailed" };
    case "not_authenticated":
      return { ok: false, error: "notAuthenticated" };
    case "no_profile":
      return { ok: false, error: "noProfile" };
    case "invalid_name":
      return { ok: false, error: "invalidName" };
    default:
      return { ok: false, error: "saveFailed" };
  }
}

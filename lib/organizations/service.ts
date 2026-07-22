import "server-only";

import { cache } from "react";
import {
  NotAuthenticatedError,
  NotAuthorizedError,
  OrganizationMissingError,
} from "@/lib/auth/errors";
import { createClient } from "@/lib/supabase/server";
import {
  canManageOrganization,
  canWriteFleetData,
  isOrgRole,
  ORGANIZATION_COLUMNS,
  USER_PROFILE_COLUMNS,
  type OrgContext,
  type OrgRole,
  type Organization,
  type UserProfile,
} from "./types";

/**
 * Server-only organization context.
 *
 * SECURITY MODEL — the organization is ALWAYS resolved from the authenticated
 * user's profile row on the server. It is never read from a form field, a query
 * string, a header, or any other client-controlled input. There is no code path
 * that accepts an organization id from the caller.
 *
 * Defense in depth, three layers:
 *   1. Supabase RLS   — `organization_id = public.current_org_id()` on every
 *                       fleet table; writes additionally require
 *                       `public.is_org_writer()`.
 *   2. Server filters — services add `.eq("organization_id", …)` explicitly, so
 *                       a policy regression cannot silently widen a query.
 *   3. Action guards  — `requireOrganizationRole()` before every mutation.
 *
 * `cache()` dedupes the profile lookup within a single request, so the many
 * server components on a page share one query instead of issuing N of them.
 */

/** The current user's profile, or null when signed out / no profile row. */
export const getCurrentUserProfile = cache(
  async (): Promise<UserProfile | null> => {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return null;

    const { data, error } = await supabase
      .from("profiles")
      .select(USER_PROFILE_COLUMNS)
      .eq("id", user.id)
      .maybeSingle();

    if (error) throw error;
    if (!data) return null;

    const row = data as {
      id: string;
      organization_id: string | null;
      role: string;
      full_name: string | null;
      phone: string | null;
      locale: string | null;
    };

    return {
      id: row.id,
      organization_id: row.organization_id,
      // An unrecognized role must never be treated as a writer. Fall back to
      // the least-privileged role rather than trusting an unexpected value.
      role: isOrgRole(row.role) ? row.role : "viewer",
      full_name: row.full_name,
      phone: row.phone,
      locale: row.locale ?? "en",
    };
  },
);

/**
 * Resolved org context for the current request.
 *
 * Throws rather than returning a fallback: silently substituting another
 * organization would be a cross-tenant data leak, so "no organization" is an
 * error, never a default.
 */
export const requireOrganization = cache(async (): Promise<OrgContext> => {
  const profile = await getCurrentUserProfile();
  if (!profile) throw new NotAuthenticatedError();
  if (!profile.organization_id) throw new OrganizationMissingError();

  return {
    userId: profile.id,
    organizationId: profile.organization_id,
    role: profile.role,
  };
});

/** The current user's organization row. */
export const getCurrentOrganization = cache(
  async (): Promise<Organization | null> => {
    const { organizationId } = await requireOrganization();
    const supabase = await createClient();

    const { data, error } = await supabase
      .from("organizations")
      .select(ORGANIZATION_COLUMNS)
      .eq("id", organizationId)
      .maybeSingle();

    if (error) throw error;
    return (data as Organization | null) ?? null;
  },
);

/**
 * Assert the current user holds one of `allowed` within their organization.
 * Returns the context so callers can use it directly:
 *
 *   const { organizationId } = await requireOrganizationRole(WRITER_ROLES);
 */
export async function requireOrganizationRole(
  allowed: readonly OrgRole[],
): Promise<OrgContext> {
  const ctx = await requireOrganization();
  if (!allowed.includes(ctx.role)) {
    throw new NotAuthorizedError(
      `Role "${ctx.role}" is not permitted for this operation`,
    );
  }
  return ctx;
}

/** Assert the user may create/update/delete fleet data (i.e. is not a viewer). */
export async function requireFleetWriter(): Promise<OrgContext> {
  const ctx = await requireOrganization();
  if (!canWriteFleetData(ctx.role)) {
    throw new NotAuthorizedError("Viewers cannot modify fleet data");
  }
  return ctx;
}

/** Assert the user may change organization settings. */
export async function requireOrganizationAdmin(): Promise<OrgContext> {
  const ctx = await requireOrganization();
  if (!canManageOrganization(ctx.role)) {
    throw new NotAuthorizedError("Only owners and admins may manage the organization");
  }
  return ctx;
}

/**
 * Non-throwing read of the current role, for rendering decisions (hiding an
 * edit button). NEVER use this to authorize a mutation — use the `require*`
 * helpers, which are also backed by RLS.
 */
export async function getCurrentRole(): Promise<OrgRole | null> {
  const profile = await getCurrentUserProfile();
  return profile?.organization_id ? profile.role : null;
}

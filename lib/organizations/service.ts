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
  type CurrentUserContext,
  type OrgContext,
  type OrgRole,
  type Organization,
  type OrganizationMember,
  type UserProfile,
} from "./types";

/**
 * Server-only organization context.
 *
 * SECURITY MODEL — authorization is resolved from the authenticated user's
 * `organization_members` row, server-side, on every request. It is never read
 * from a form field, a query string, a header, or any other client-controlled
 * input. There is no code path that accepts an organization id from the caller.
 *
 * MEMBERSHIP IS THE AUTHORITY. `profiles.organization_id` and `profiles.role`
 * survive only as a denormalized "current org" cache — convenient for the
 * signup default and for display — and they grant nothing on their own:
 *
 *   * a profile pointing at an organization with no matching membership row
 *     resolves to NO access (OrganizationMissingError), and
 *   * when the cache and the membership disagree, the MEMBERSHIP wins, in both
 *     directions: a stale `profiles.role = 'owner'` cannot elevate a viewer, and
 *     a stale `profiles.role = 'viewer'` cannot demote an owner.
 *
 * The cache is kept in step by `accept_invitation()` and by the member-role
 * service below. Users cannot write it directly: `profiles` RLS permits a user
 * to update only their own row, and the org columns are never included in any
 * update this app issues. A drifted cache is therefore cosmetic, never a
 * privilege change.
 *
 * Defense in depth, three layers:
 *   1. Supabase RLS   — `organization_id = public.current_org_id()` on every
 *                       fleet table (and `current_org_id()` reads
 *                       `organization_members`); writes additionally require
 *                       `public.is_org_writer()`.
 *   2. Server filters — services add `.eq("organization_id", …)` explicitly, so
 *                       a policy regression cannot silently widen a query.
 *   3. Action guards  — `requireOrganizationRole()` before every mutation.
 *
 * `cache()` dedupes the lookups within a single request, so the many server
 * components on a page share one query instead of issuing N of them.
 */

/** The authenticated user id, or null when signed out. */
const getAuthUserId = cache(async (): Promise<string | null> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user?.id ?? null;
});

/**
 * The current user's membership row — the single source of truth for which
 * organization they act in and with what role. `null` means no access.
 */
export const getCurrentMembership = cache(
  async (): Promise<OrganizationMember | null> => {
    const userId = await getAuthUserId();
    if (!userId) return null;

    const supabase = await createClient();
    const { data, error } = await supabase
      .from("organization_members")
      .select("id, organization_id, user_id, role, created_at")
      .eq("user_id", userId)
      .maybeSingle();

    if (error) throw error;
    if (!data) return null;

    const row = data as {
      id: string;
      organization_id: string;
      user_id: string;
      role: string;
      created_at: string;
    };

    return {
      id: row.id,
      organization_id: row.organization_id,
      user_id: row.user_id,
      // An unrecognized role must never be treated as a writer. Fall back to
      // the least-privileged role rather than trusting an unexpected value.
      role: isOrgRole(row.role) ? row.role : "viewer",
      created_at: row.created_at,
    };
  },
);

/**
 * The current user's profile.
 *
 * `organization_id` and `role` are served from the MEMBERSHIP, not from the
 * profile row's cached copies, so that any caller reading this — including one
 * that predates the membership model — cannot act on a stale cache.
 */
export const getCurrentUserProfile = cache(
  async (): Promise<UserProfile | null> => {
    const userId = await getAuthUserId();
    if (!userId) return null;

    const supabase = await createClient();
    const { data, error } = await supabase
      .from("profiles")
      .select(USER_PROFILE_COLUMNS)
      .eq("id", userId)
      .maybeSingle();

    if (error) throw error;
    if (!data) return null;

    const row = data as {
      id: string;
      full_name: string | null;
      phone: string | null;
      locale: string | null;
    };

    const membership = await getCurrentMembership();

    return {
      id: row.id,
      // Membership overrides the profile cache — never the other way round.
      organization_id: membership?.organization_id ?? null,
      role: membership?.role ?? "viewer",
      full_name: row.full_name,
      phone: row.phone,
      locale: row.locale ?? "en",
    };
  },
);

/**
 * Resolved org context for the current request, from the membership row.
 *
 * Throws rather than returning a fallback: silently substituting another
 * organization would be a cross-tenant data leak, so "no organization" is an
 * error, never a default.
 */
export const requireOrganization = cache(async (): Promise<OrgContext> => {
  const userId = await getAuthUserId();
  if (!userId) throw new NotAuthenticatedError();

  const membership = await getCurrentMembership();
  if (!membership) throw new OrganizationMissingError();

  return {
    userId: membership.user_id,
    organizationId: membership.organization_id,
    role: membership.role,
  };
});

/**
 * The full picture of who is acting: profile, organization, membership,
 * effective role and organization display name. Returns `null` when signed out.
 * Unlike {@link requireOrganization} this never throws for a user without a
 * membership — it reports `membership: null` so a screen can explain the state.
 */
export const getCurrentUserContext = cache(
  async (): Promise<CurrentUserContext | null> => {
    const profile = await getCurrentUserProfile();
    if (!profile) return null;

    const membership = await getCurrentMembership();
    const organization = membership ? await getCurrentOrganization() : null;

    return {
      profile,
      organization,
      membership,
      effectiveRole: membership?.role ?? null,
      organizationName: organization?.name ?? null,
    };
  },
);

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
  const membership = await getCurrentMembership();
  return membership?.role ?? null;
}

/** Assert the current user is an owner (the only role that may manage owners). */
export async function requireOrganizationOwner(): Promise<OrgContext> {
  const ctx = await requireOrganization();
  if (ctx.role !== "owner") {
    throw new NotAuthorizedError("Only owners may perform this operation");
  }
  return ctx;
}

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

function toMembership(row: {
  id: string;
  organization_id: string;
  user_id: string;
  role: string;
  created_at: string;
}): OrganizationMember {
  return {
    id: row.id,
    organization_id: row.organization_id,
    user_id: row.user_id,
    // An unrecognized role must never be treated as a writer. Fall back to the
    // least-privileged role rather than trusting an unexpected value.
    role: isOrgRole(row.role) ? row.role : "viewer",
    created_at: row.created_at,
  };
}

/**
 * EVERY membership this user holds, personal workspace first, then oldest.
 *
 * This replaces the old `getCurrentMembership()`, which used `.maybeSingle()`
 * and therefore THREW the moment a user held a second membership. That call was
 * the application-side half of the `UNIQUE(user_id)` assumption; the SQL half
 * lived in `current_org_id()` and friends.
 *
 * The ordering matches `current_org_id()`'s fallback chain and the workspace
 * selector's render order, so the three never present a different "first"
 * workspace.
 */
export const listMemberships = cache(
  async (): Promise<OrganizationMember[]> => {
    const userId = await getAuthUserId();
    if (!userId) return [];

    const supabase = await createClient();
    const { data, error } = await supabase
      .from("organization_members")
      .select("id, organization_id, user_id, role, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true });

    if (error) throw error;
    return ((data ?? []) as Parameters<typeof toMembership>[0][]).map(
      toMembership,
    );
  },
);

/**
 * The membership for the ACTIVE workspace, or `null`.
 *
 * The active organization is resolved by the database — `current_org_id()` —
 * rather than recomputed here, so the row this returns is guaranteed to be the
 * one every RLS policy on the request will scope to. Resolving it independently
 * in TypeScript would be a second source of truth, and the two could disagree.
 */
export const getActiveMembership = cache(
  async (): Promise<OrganizationMember | null> => {
    const userId = await getAuthUserId();
    if (!userId) return null;

    const supabase = await createClient();
    const { data: activeOrgId, error: rpcError } =
      await supabase.rpc("current_org_id");
    if (rpcError) throw rpcError;
    if (!activeOrgId) return null;

    const { data, error } = await supabase
      .from("organization_members")
      .select("id, organization_id, user_id, role, created_at")
      .eq("user_id", userId)
      .eq("organization_id", activeOrgId as string)
      .maybeSingle();

    if (error) throw error;
    if (!data) return null;
    return toMembership(data as Parameters<typeof toMembership>[0]);
  },
);

/** This user's membership in one specific organization, or `null`. */
export async function getMembershipFor(
  organizationId: string,
): Promise<OrganizationMember | null> {
  const memberships = await listMemberships();
  return (
    memberships.find((m) => m.organization_id === organizationId) ?? null
  );
}

/**
 * The workspace a user lands in when they have expressed no preference.
 *
 * Mirrors steps 2-4 of `current_org_id()` in TypeScript, for callers that need
 * the answer without a round trip. It is NOT used to authorize anything — the
 * database's own resolution is what RLS applies.
 */
export async function resolveDefaultOrganization(): Promise<string | null> {
  const memberships = await listMemberships();
  if (memberships.length === 0) return null;

  const supabase = await createClient();
  const { data } = await supabase
    .from("organizations")
    .select("id, kind")
    .in("id", memberships.map((m) => m.organization_id));

  const personal = ((data ?? []) as { id: string; kind: string }[]).find(
    (o) => o.kind === "personal",
  );
  if (personal) return personal.id;

  // listMemberships() is already ordered (created_at, id).
  return memberships[0].organization_id;
}

/**
 * One workspace as the selector renders it. Comes from `list_my_workspaces()`,
 * which is SECURITY DEFINER because `organizations` RLS would otherwise show
 * the caller only the workspace they are already in.
 */
export interface WorkspaceSummary {
  organizationId: string;
  name: string;
  kind: "personal" | "business";
  role: OrgRole;
  isActive: boolean;
  joinedAt: string;
}

export const listWorkspaces = cache(async (): Promise<WorkspaceSummary[]> => {
  const userId = await getAuthUserId();
  if (!userId) return [];

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("list_my_workspaces");
  if (error) throw error;

  return ((data ?? []) as {
    organization_id: string;
    name: string;
    kind: string;
    role: string;
    is_active: boolean;
    joined_at: string;
  }[]).map((row) => ({
    organizationId: row.organization_id,
    name: row.name,
    kind: row.kind === "personal" ? "personal" : "business",
    role: isOrgRole(row.role) ? row.role : "viewer",
    isActive: row.is_active,
    joinedAt: row.joined_at,
  }));
});

/** Whether the active workspace is this user's personal one. */
export async function isPersonalWorkspace(): Promise<boolean> {
  const workspaces = await listWorkspaces();
  return workspaces.some((w) => w.isActive && w.kind === "personal");
}

export type SwitchWorkspaceResult =
  | { ok: true; organizationId: string | null }
  | { ok: false; error: "notAuthenticated" | "notAMember" | "failed" };

/**
 * Switch the active workspace.
 *
 * Delegates to `set_active_organization()`, which re-checks membership inside
 * the database and writes nothing if the caller does not belong to the target.
 * Doing the check only here would be insufficient — but doing it only in the
 * database would give the user no error, because `current_org_id()` silently
 * falls back rather than failing. Both layers earn their place.
 *
 * Switching changes no ownership, no role and no data.
 */
export async function switchWorkspace(
  organizationId: string | null,
): Promise<SwitchWorkspaceResult> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("set_active_organization", {
    p_organization: organizationId,
  });

  if (error) {
    console.error("[organizations] switchWorkspace failed:", {
      code: error.code,
    });
    return { ok: false, error: "failed" };
  }

  const result = (data ?? {}) as { state?: string; organization_id?: string };
  if (result.state === "ok") {
    return { ok: true, organizationId: result.organization_id ?? null };
  }
  if (result.state === "not_a_member") {
    return { ok: false, error: "notAMember" };
  }
  if (result.state === "not_authenticated") {
    return { ok: false, error: "notAuthenticated" };
  }
  return { ok: false, error: "failed" };
}

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

    const membership = await getActiveMembership();

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

  const membership = await getActiveMembership();
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

    const membership = await getActiveMembership();
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
  const membership = await getActiveMembership();
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

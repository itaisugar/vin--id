import "server-only";

import { NotAuthorizedError, OrganizationMissingError } from "@/lib/auth/errors";
import { createClient } from "@/lib/supabase/server";
import {
  requireOrganization,
  requireOrganizationAdmin,
} from "./service";
import {
  isOrgRole,
  type MemberActionResult,
  type OrganizationMember,
  type OrganizationMemberListItem,
  type OrgRole,
} from "./types";

/**
 * Organization member management.
 *
 * AUTHORIZATION, three layers, in this order:
 *   1. `requireOrganizationAdmin()` resolves the caller's org and role from
 *      their `organization_members` row. Nothing here accepts an organization
 *      id from the client — only a member id, which is then re-checked against
 *      the caller's own organization.
 *   2. Explicit role rules below (owners manage everyone; admins manage
 *      non-owners only).
 *   3. RLS on `organization_members` re-applies the same rules, and the
 *      `protect_last_owner` trigger has the final word on the last owner. A
 *      write that RLS refuses affects zero rows, which is reported as
 *      `notAuthorized` rather than a silent success.
 */

/** Postgres check_violation — raised by the last-owner trigger. */
const CHECK_VIOLATION = "23514";

/** Roles that may never be assigned by anyone but an owner. */
function requiresOwnership(role: OrgRole): boolean {
  return role === "owner";
}

/**
 * The roster of the caller's organization. Owner/admin only — enforced in the
 * `list_organization_members()` RPC, which derives the organization from the
 * caller's membership and joins the identity columns that RLS on `profiles`
 * and `auth.users` would otherwise (correctly) hide.
 */
export async function listOrganizationMembers(): Promise<
  OrganizationMemberListItem[]
> {
  const { organizationId } = await requireOrganizationAdmin();
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("list_organization_members");
  if (error) throw error;

  const rows = (data ?? []) as {
    id: string;
    user_id: string;
    role: string;
    created_at: string;
    email: string | null;
    full_name: string | null;
  }[];

  return rows.map((row) => ({
    id: row.id,
    organization_id: organizationId,
    user_id: row.user_id,
    role: isOrgRole(row.role) ? row.role : "viewer",
    created_at: row.created_at,
    email: row.email,
    full_name: row.full_name,
  }));
}

/** Look up a member inside the caller's own organization. */
async function findMemberInOwnOrg(
  memberId: string,
  organizationId: string,
): Promise<OrganizationMember | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("organization_members")
    .select("id, organization_id, user_id, role, created_at")
    .eq("id", memberId)
    // Belt and braces: RLS already restricts this to the caller's org.
    .eq("organization_id", organizationId)
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
    role: isOrgRole(row.role) ? row.role : "viewer",
    created_at: row.created_at,
  };
}

/**
 * Change a member's role.
 *
 * Owners may set any role, including promoting another member to owner or
 * stepping down once a second owner exists. Admins may only move non-owners
 * between non-owner roles. The last owner of a live organization can never be
 * demoted — the database trigger rejects it even if this check were bypassed.
 */
export async function changeMemberRole(
  memberId: string,
  role: OrgRole,
): Promise<MemberActionResult> {
  if (!isOrgRole(role)) return { ok: false, error: "invalidRole" };

  let ctx;
  try {
    ctx = await requireOrganizationAdmin();
  } catch (error) {
    if (
      error instanceof NotAuthorizedError ||
      error instanceof OrganizationMissingError
    ) {
      return { ok: false, error: "notAuthorized" };
    }
    throw error;
  }

  const target = await findMemberInOwnOrg(memberId, ctx.organizationId);
  if (!target) return { ok: false, error: "memberNotFound" };

  // Admins may neither touch an owner nor create one.
  if (
    ctx.role !== "owner" &&
    (requiresOwnership(target.role) || requiresOwnership(role))
  ) {
    return { ok: false, error: "cannotManageOwner" };
  }

  if (target.role === role) return { ok: true };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("organization_members")
    .update({ role })
    .eq("id", memberId)
    .eq("organization_id", ctx.organizationId)
    .select("id");

  if (error) {
    if (error.code === CHECK_VIOLATION) return { ok: false, error: "lastOwner" };
    console.error("[organizations] changeMemberRole failed:", {
      code: error.code,
      message: error.message,
    });
    return { ok: false, error: "saveFailed" };
  }
  // RLS refused the row: report it rather than pretending the change happened.
  if (!data || data.length === 0) return { ok: false, error: "notAuthorized" };

  // Keep the profile "current org" cache in step. Best-effort and non-
  // authoritative: the membership row above is what actually governs access.
  const { error: cacheError } = await supabase
    .from("profiles")
    .update({ role })
    .eq("id", target.user_id);
  if (cacheError) {
    console.warn("[organizations] profile role cache not synced:", {
      code: cacheError.code,
    });
  }

  return { ok: true };
}

/**
 * Remove a member from the organization.
 *
 * Admins may remove non-owners; owners may remove anyone, except that the last
 * owner of a live organization cannot be removed (database trigger).
 */
export async function removeMember(
  memberId: string,
): Promise<MemberActionResult> {
  let ctx;
  try {
    ctx = await requireOrganizationAdmin();
  } catch (error) {
    if (
      error instanceof NotAuthorizedError ||
      error instanceof OrganizationMissingError
    ) {
      return { ok: false, error: "notAuthorized" };
    }
    throw error;
  }

  const target = await findMemberInOwnOrg(memberId, ctx.organizationId);
  if (!target) return { ok: false, error: "memberNotFound" };

  if (ctx.role !== "owner" && requiresOwnership(target.role)) {
    return { ok: false, error: "cannotManageOwner" };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("organization_members")
    .delete()
    .eq("id", memberId)
    .eq("organization_id", ctx.organizationId)
    .select("id");

  if (error) {
    if (error.code === CHECK_VIOLATION) return { ok: false, error: "lastOwner" };
    console.error("[organizations] removeMember failed:", {
      code: error.code,
      message: error.message,
    });
    return { ok: false, error: "saveFailed" };
  }
  if (!data || data.length === 0) return { ok: false, error: "notAuthorized" };

  // Clear the removed user's cached pointer so nothing displays a stale org.
  // Access is already gone the moment the membership row disappeared.
  const { error: cacheError } = await supabase
    .from("profiles")
    .update({ organization_id: null })
    .eq("id", target.user_id);
  if (cacheError) {
    console.warn("[organizations] profile org cache not cleared:", {
      code: cacheError.code,
    });
  }

  return { ok: true };
}

/** Minimal organization settings for the team screen header. */
export async function getOrganizationSummary(): Promise<{
  id: string;
  name: string;
  role: OrgRole;
} | null> {
  const { organizationId, role } = await requireOrganization();
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("organizations")
    .select("id, name")
    .eq("id", organizationId)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  const row = data as { id: string; name: string };
  return { id: row.id, name: row.name, role };
}

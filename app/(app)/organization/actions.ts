"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  createInvitation,
  revokeInvitation,
} from "@/lib/organizations/invitations";
import {
  createBusinessOrganization,
  type CreateOrganizationErrorKey,
} from "@/lib/organizations/organization";
import { changeMemberRole, removeMember } from "@/lib/organizations/members";
import {
  isOrgRole,
  type InvitationErrorKey,
  type MemberErrorKey,
} from "@/lib/organizations/types";

/**
 * Organization team actions.
 *
 * Every action re-resolves the caller's organization and role server-side (the
 * service layer does this via `requireOrganizationAdmin()`); none of them
 * accepts an organization id, a user id or a role claim from the client. The
 * only client input is an opaque member/invitation id, which the service
 * re-checks against the caller's own organization.
 *
 * Returned `error` values are translation keys under `organization.team.errors`.
 */

export type InviteActionState = {
  error?: InvitationErrorKey;
  /**
   * The one-time invite link, returned to the caller so it can be copied. It is
   * never persisted and never logged; refreshing the page loses it, and the
   * invitation must then be revoked and reissued.
   */
  inviteUrl?: string;
  email?: string;
};

export async function createInvitationAction(
  values: unknown,
): Promise<InviteActionState> {
  const result = await createInvitation(values);
  if (!result.ok) return { error: result.error };

  revalidatePath("/organization");
  return { inviteUrl: result.inviteUrl, email: result.invitation.email };
}

export type CreateOrganizationActionState = {
  error?: CreateOrganizationErrorKey;
};

/**
 * Create a separate Business organization for the current user.
 *
 * The service delegates to the `create_business_organization()` RPC, which
 * derives the owner from `auth.uid()`, so nothing here trusts a client-supplied
 * id, owner or role. On success the new organization is already the active
 * workspace (set inside the RPC), so the whole app is revalidated and the user
 * is sent to the Business Team & Access screen — the create form only ever
 * renders in a Personal workspace, so a redirect there is the success feedback.
 */
export async function createOrganizationAction(
  values: unknown,
): Promise<CreateOrganizationActionState> {
  const result = await createBusinessOrganization(values);
  if (!result.ok) return { error: result.error };

  revalidatePath("/", "layout");
  redirect("/organization");
}

export type MemberActionState = { error?: MemberErrorKey; success?: boolean };

export async function revokeInvitationAction(
  invitationId: string,
): Promise<{ error?: InvitationErrorKey; success?: boolean }> {
  if (typeof invitationId !== "string" || invitationId.length === 0) {
    return { error: "saveFailed" };
  }

  const result = await revokeInvitation(invitationId);
  if (!result.ok) return { error: result.error };

  revalidatePath("/organization");
  return { success: true };
}

export async function changeMemberRoleAction(
  memberId: string,
  role: unknown,
): Promise<MemberActionState> {
  if (typeof memberId !== "string" || memberId.length === 0) {
    return { error: "memberNotFound" };
  }
  if (!isOrgRole(role)) return { error: "invalidRole" };

  const result = await changeMemberRole(memberId, role);
  if (!result.ok) return { error: result.error };

  revalidatePath("/organization");
  return { success: true };
}

export async function removeMemberAction(
  memberId: string,
): Promise<MemberActionState> {
  if (typeof memberId !== "string" || memberId.length === 0) {
    return { error: "memberNotFound" };
  }

  const result = await removeMember(memberId);
  if (!result.ok) return { error: result.error };

  revalidatePath("/organization");
  return { success: true };
}

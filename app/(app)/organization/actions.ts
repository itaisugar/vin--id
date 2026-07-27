"use server";

import { revalidatePath } from "next/cache";
import {
  createInvitation,
  revokeInvitation,
} from "@/lib/organizations/invitations";
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

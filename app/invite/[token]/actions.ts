"use server";

import { revalidatePath } from "next/cache";
import { acceptInvitation } from "@/lib/organizations/invitations";
import type { AcceptInvitationResult } from "@/lib/organizations/types";

/**
 * Explicit invitation acceptance.
 *
 * Invoked only from the Accept button — never on page load. The accepting user
 * is derived from the session inside `accept_invitation()` in the database; this
 * action forwards nothing but the raw token, and never logs it.
 */
export async function acceptInvitationAction(
  token: unknown,
): Promise<AcceptInvitationResult> {
  if (typeof token !== "string" || token.length === 0) {
    return { state: "invalid" };
  }

  const result = await acceptInvitation(token);

  if (result.state === "ok") {
    // The user's organization changed: drop cached org-scoped renders.
    revalidatePath("/", "layout");
  }

  return result;
}

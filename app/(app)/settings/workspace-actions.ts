"use server";

import { revalidatePath } from "next/cache";
import { switchWorkspace } from "@/lib/organizations/service";

export type SwitchWorkspaceState = { error?: string } | undefined;

/**
 * Switch the active workspace.
 *
 * The organization id arrives from the client, which is exactly why nothing
 * here trusts it: `switchWorkspace()` calls `set_active_organization()`, which
 * re-derives the user from `auth.uid()` and verifies membership inside the
 * database before writing. A caller who posts an organization they do not
 * belong to gets `notAMember` and no write happens.
 *
 * Even if that check were bypassed, the pointer alone grants nothing —
 * `current_org_id()` validates it against a live membership on every read. This
 * action exists to give the user a clear error, not to be the security boundary.
 *
 * The whole app is revalidated because the active workspace changes what every
 * org-scoped screen returns.
 */
export async function switchWorkspaceAction(
  _prevState: SwitchWorkspaceState,
  formData: FormData,
): Promise<SwitchWorkspaceState> {
  const raw = formData.get("organizationId");
  const organizationId = typeof raw === "string" && raw ? raw : null;

  const result = await switchWorkspace(organizationId);
  if (!result.ok) {
    return { error: result.error };
  }

  revalidatePath("/", "layout");
  return {};
}

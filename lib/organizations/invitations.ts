import "server-only";

import { createHash, randomBytes } from "node:crypto";
import * as z from "zod";
import { AppUrlNotConfiguredError, getAppBaseUrl } from "@/lib/app-url";
import { NotAuthorizedError, OrganizationMissingError } from "@/lib/auth/errors";
import { createClient } from "@/lib/supabase/server";
import {
  isPersonalWorkspace,
  requireOrganization,
  requireOrganizationAdmin,
} from "./service";
import {
  invitationInputSchema,
  INVITATION_COLUMNS,
  isInvitableRole,
  type AcceptInvitationResult,
  type CreateInvitationResult,
  type InvitationErrorKey,
  type InvitationPreview,
  type OrganizationInvitation,
} from "./types";

/**
 * Organization invitations.
 *
 * TOKEN HANDLING — the same shape as the Passport transfer tokens:
 *
 *   * The raw token is generated here with `randomBytes(32)` (256 bits from the
 *     CSPRNG) and rendered base64url.
 *   * Only its SHA-256 hash is ever written to the database, so a database
 *     leak does not yield usable invite links.
 *   * The raw token is returned exactly ONCE, inside the invite URL from
 *     {@link createInvitation}, and is never persisted, cached or logged. If it
 *     is lost, the invitation must be revoked and reissued.
 *   * Nothing here logs a raw token or a token hash — not on success, not in an
 *     error path. Error logs carry only the Postgres error code.
 *
 * Lookups go through `get_invitation_preview()` / `accept_invitation()`, which
 * are SECURITY DEFINER with a pinned empty `search_path` and no dynamic SQL.
 * Acceptance derives the accepting user from `auth.uid()` inside the database —
 * this layer never tells it who is accepting or which organization to join.
 */

const TOKEN_BYTES = 32;

/** Unique violation — a pending invitation already exists for this address. */
const UNIQUE_VIOLATION = "23505";

function hashToken(rawToken: string): string {
  return createHash("sha256").update(rawToken).digest("hex");
}

/** Fresh, cryptographically secure invitation token. Never stored. */
function generateToken(): string {
  return randomBytes(TOKEN_BYTES).toString("base64url");
}

function mapRow(row: Record<string, unknown>): OrganizationInvitation {
  return {
    id: row.id as string,
    organization_id: row.organization_id as string,
    email: row.email as string,
    role: isInvitableRole(row.role) ? row.role : "viewer",
    status: row.status as OrganizationInvitation["status"],
    created_at: row.created_at as string,
    expires_at: row.expires_at as string,
    accepted_at: (row.accepted_at as string | null) ?? null,
    revoked_at: (row.revoked_at as string | null) ?? null,
  };
}

/**
 * Invitations for the caller's organization, newest first. Owner/admin only.
 *
 * Selects an explicit column list — never `select *`, which would pull
 * `token_hash` out of the database and into application memory.
 */
export async function listInvitations(): Promise<OrganizationInvitation[]> {
  const { organizationId } = await requireOrganizationAdmin();
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("organization_invitations")
    .select(INVITATION_COLUMNS)
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false });

  if (error) throw error;
  return ((data ?? []) as Record<string, unknown>[]).map(mapRow);
}

/** Pending, not-yet-expired invitations only. */
export async function listPendingInvitations(): Promise<
  OrganizationInvitation[]
> {
  const now = Date.now();
  return (await listInvitations()).filter(
    (invitation) =>
      invitation.status === "pending" &&
      new Date(invitation.expires_at).getTime() > now,
  );
}

/**
 * Create an invitation and return its one-time link.
 *
 * Duplicate handling is intentional rather than incidental: a partial unique
 * index allows only one PENDING invitation per (organization, email). A stale
 * pending row whose `expires_at` has passed is first marked `expired`, so
 * re-inviting someone whose link lapsed just works; a genuinely live pending
 * invitation is reported as `duplicatePending` instead of quietly issuing a
 * second working link.
 */
export async function createInvitation(
  values: unknown,
): Promise<CreateInvitationResult> {
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

  // A Personal workspace is one person's private vehicle environment — it cannot
  // have members. The database enforces this too (the invitation INSERT policy
  // rejects a personal org), but checking here returns a clear, stable state
  // instead of a generic RLS failure. UI hiding is not the boundary; this and
  // the policy are.
  if (await isPersonalWorkspace()) {
    return { ok: false, error: "personalWorkspace" };
  }

  const parsed = invitationInputSchema.safeParse(values);
  if (!parsed.success) {
    const flattened = z.flattenError(parsed.error).fieldErrors as Record<
      string,
      string[] | undefined
    >;
    const key = flattened.email?.[0] ?? flattened.role?.[0] ?? "saveFailed";
    return { ok: false, error: key as InvitationErrorKey };
  }
  const { email, role } = parsed.data;

  const supabase = await createClient();

  // Someone already in the organization does not need an invitation.
  const { data: existing, error: existingError } = await supabase.rpc(
    "list_organization_members",
  );
  if (existingError) throw existingError;
  const alreadyMember = ((existing ?? []) as { email: string | null }[]).some(
    (member) => (member.email ?? "").toLowerCase() === email,
  );
  if (alreadyMember) return { ok: false, error: "alreadyMember" };

  // Retire a lapsed pending invitation so the partial unique index frees up.
  const { error: sweepError } = await supabase
    .from("organization_invitations")
    .update({ status: "expired" })
    .eq("organization_id", ctx.organizationId)
    .eq("email", email)
    .eq("status", "pending")
    .lt("expires_at", new Date().toISOString());
  if (sweepError) {
    console.error("[organizations] expiring stale invitation failed:", {
      code: sweepError.code,
    });
  }

  // Build the link before inserting, so a failure to resolve the public base
  // URL never leaves an unusable invitation row behind.
  let baseUrl: string;
  try {
    baseUrl = await getAppBaseUrl();
  } catch (error) {
    if (error instanceof AppUrlNotConfiguredError) {
      return { ok: false, error: "linkUnavailable" };
    }
    throw error;
  }

  const rawToken = generateToken();

  const { data, error } = await supabase
    .from("organization_invitations")
    .insert({
      organization_id: ctx.organizationId,
      email,
      role,
      token_hash: hashToken(rawToken),
      invited_by: ctx.userId,
    })
    .select(INVITATION_COLUMNS)
    .single();

  if (error) {
    if (error.code === UNIQUE_VIOLATION) {
      return { ok: false, error: "duplicatePending" };
    }
    // Never log the token or its hash — only the Postgres error code.
    console.error("[organizations] createInvitation failed:", {
      code: error.code,
    });
    return { ok: false, error: "saveFailed" };
  }

  return {
    ok: true,
    invitation: mapRow(data as Record<string, unknown>),
    inviteUrl: `${baseUrl}/invite/${rawToken}`,
  };
}

/**
 * Revoke a pending invitation. Invitations are never hard-deleted — the row
 * stays as an audit trail and its token can never be reused.
 */
export async function revokeInvitation(
  invitationId: string,
): Promise<{ ok: true } | { ok: false; error: InvitationErrorKey }> {
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

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("organization_invitations")
    .update({ status: "revoked", revoked_at: new Date().toISOString() })
    .eq("id", invitationId)
    .eq("organization_id", ctx.organizationId)
    .eq("status", "pending")
    .select("id");

  if (error) {
    console.error("[organizations] revokeInvitation failed:", {
      code: error.code,
    });
    return { ok: false, error: "saveFailed" };
  }
  if (!data || data.length === 0) return { ok: false, error: "notAuthorized" };

  return { ok: true };
}

/**
 * Read-only preview of an invitation from its raw token.
 *
 * Safe to call before sign-in: the RPC returns only the organization's display
 * name, the offered role, a MASKED email and the expiry, and it creates no
 * membership. Callable by anon precisely so the landing page can explain itself
 * to a signed-out recipient.
 */
export async function previewInvitation(
  rawToken: string,
): Promise<InvitationPreview> {
  if (!rawToken) return { state: "invalid" };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_invitation_preview", {
    p_token_hash: hashToken(rawToken),
  });

  if (error) {
    console.error("[organizations] previewInvitation failed:", {
      code: error.code,
    });
    return { state: "invalid" };
  }
  return (data ?? { state: "invalid" }) as InvitationPreview;
}

/**
 * Accept an invitation as the currently authenticated user.
 *
 * All of the decisions — token validity, expiry, revocation, replay, email
 * match, role, and the one-organization rule — are made inside
 * `accept_invitation()` in a single transaction, so a half-accepted invitation
 * is not representable and concurrent attempts create exactly one membership.
 */
export async function acceptInvitation(
  rawToken: string,
): Promise<AcceptInvitationResult> {
  if (!rawToken) return { state: "invalid" };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("accept_invitation", {
    p_token_hash: hashToken(rawToken),
  });

  if (error) {
    console.error("[organizations] acceptInvitation failed:", {
      code: error.code,
    });
    return { state: "failed" };
  }

  const result = (data ?? {}) as { state?: string; organization_id?: string };
  if (result.state === "ok" && result.organization_id) {
    return { state: "ok", organization_id: result.organization_id };
  }
  return {
    state: (result.state ?? "failed") as Exclude<
      AcceptInvitationResult,
      { state: "ok" }
    >["state"],
  };
}

/** True when the signed-in user already belongs to an organization. */
export async function hasOrganization(): Promise<boolean> {
  try {
    await requireOrganization();
    return true;
  } catch {
    return false;
  }
}

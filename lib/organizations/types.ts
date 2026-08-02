import * as z from "zod";

// -----------------------------------------------------------------------------
// Roles
// -----------------------------------------------------------------------------
/**
 * Role model — deliberately flat. No custom roles, no permission matrix, no
 * multi-org membership: one user belongs to one organization with one role.
 *
 *   owner         full access, including organization settings
 *   admin         full operational access + organization settings
 *   fleet_manager manages vehicles and fleet operations, not org settings
 *   viewer        organization-wide READ-ONLY
 *   driver        ONE assigned vehicle only — not a narrower viewer
 *
 * `driver` is not a lesser `viewer`. A viewer reads the whole organization; a
 * driver reads a single assigned vehicle and a small allowlist of related
 * records, and is denied every cost-bearing table outright. The two are
 * separate roles with separate rules, enforced in the database by
 * 20260725220000_driver_rls.sql — not by this file. Nothing here grants access;
 * these constants exist so the UI can mirror the database rule, and the
 * database is what actually holds the line.
 */
export const ORG_ROLES = [
  "owner",
  "admin",
  "fleet_manager",
  "viewer",
  "driver",
] as const;
export type OrgRole = (typeof ORG_ROLES)[number];

/** Roles allowed to create/update/delete fleet data. Mirrors `is_org_writer()`. */
export const WRITER_ROLES: readonly OrgRole[] = [
  "owner",
  "admin",
  "fleet_manager",
];

/** Roles allowed to change organization settings. Mirrors the org RLS policy. */
export const ORG_ADMIN_ROLES: readonly OrgRole[] = ["owner", "admin"];

/**
 * Roles allowed to assign, replace and end driver assignments.
 * Mirrors `can_manage_driver_assignments()`.
 *
 * Deliberately NOT the same set as {@link ORG_ADMIN_ROLES}: a fleet_manager may
 * hand a vehicle to a driver, but may not invite or remove members. Assignment
 * rights and membership rights are separate.
 */
export const ASSIGNMENT_MANAGER_ROLES: readonly OrgRole[] = [
  "owner",
  "admin",
  "fleet_manager",
];

/** Is this the assigned-vehicle-only role? Mirrors `is_org_driver()`. */
export function isDriverRole(role: OrgRole | null | undefined): boolean {
  return role === "driver";
}

/** May this role manage driver assignments? */
export function canManageAssignments(role: OrgRole | null | undefined): boolean {
  return role != null && ASSIGNMENT_MANAGER_ROLES.includes(role);
}

export function isOrgRole(value: unknown): value is OrgRole {
  return (
    typeof value === "string" && (ORG_ROLES as readonly string[]).includes(value)
  );
}

/** Can this role write fleet data? The DB enforces the same rule via RLS. */
export function canWriteFleetData(role: OrgRole): boolean {
  return WRITER_ROLES.includes(role);
}

/** Can this role change organization settings? */
export function canManageOrganization(role: OrgRole): boolean {
  return ORG_ADMIN_ROLES.includes(role);
}

// -----------------------------------------------------------------------------
// Row shapes
// -----------------------------------------------------------------------------
export const SUBSCRIPTION_STATUSES = [
  "trial",
  "active",
  "past_due",
  "canceled",
] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

export interface Organization {
  id: string;
  name: string;
  business_type: string | null;
  contact_name: string | null;
  phone: string | null;
  email: string | null;
  subscription_status: SubscriptionStatus;
  plan: string | null;
  created_at: string;
  updated_at: string;
}

export const ORGANIZATION_COLUMNS =
  "id, name, business_type, contact_name, phone, email, subscription_status, plan, created_at, updated_at";

/** The current user's profile, including their organization membership. */
export interface UserProfile {
  id: string;
  organization_id: string | null;
  role: OrgRole;
  full_name: string | null;
  phone: string | null;
  locale: string;
}

export const USER_PROFILE_COLUMNS =
  "id, organization_id, role, full_name, phone, locale";

/** Resolved organization context for a request. Never built from client input. */
export interface OrgContext {
  userId: string;
  organizationId: string;
  role: OrgRole;
}

// -----------------------------------------------------------------------------
// Membership
// -----------------------------------------------------------------------------
/**
 * A row of `organization_members` — the AUTHORITY for what a user may do.
 * `profiles.organization_id` / `profiles.role` are only a denormalized cache of
 * the same facts and never grant access on their own.
 */
export interface OrganizationMember {
  id: string;
  organization_id: string;
  user_id: string;
  role: OrgRole;
  created_at: string;
}

/** A member as shown on the team screen, joined with their identity. */
export interface OrganizationMemberListItem extends OrganizationMember {
  email: string | null;
  full_name: string | null;
}

/**
 * Everything a request needs to know about who is acting. Assembled server-side
 * from the session plus the membership row — never from client input.
 */
export interface CurrentUserContext {
  profile: UserProfile;
  organization: Organization | null;
  membership: OrganizationMember | null;
  /** The role that actually governs access. `null` when there is no membership. */
  effectiveRole: OrgRole | null;
  organizationName: string | null;
}

// -----------------------------------------------------------------------------
// Invitations
// -----------------------------------------------------------------------------
/**
 * Roles an invitation may carry. `owner` is deliberately absent: ownership is
 * granted by promoting an existing member, never by emailing a link. The
 * database CHECK constraint on `organization_invitations.role` mirrors this.
 */
export const INVITABLE_ROLES = [
  "admin",
  "fleet_manager",
  "viewer",
  "driver",
] as const;
export type InvitableRole = (typeof INVITABLE_ROLES)[number];

export function isInvitableRole(value: unknown): value is InvitableRole {
  return (
    typeof value === "string" &&
    (INVITABLE_ROLES as readonly string[]).includes(value)
  );
}

export const INVITATION_STATUSES = [
  "pending",
  "accepted",
  "revoked",
  "expired",
] as const;
export type InvitationStatus = (typeof INVITATION_STATUSES)[number];

/**
 * A pending/handled invitation as shown to an admin.
 *
 * `token_hash` is intentionally NOT part of this type. The raw token exists only
 * in the response of {@link createInvitation}; the hash never leaves the
 * database.
 */
export interface OrganizationInvitation {
  id: string;
  organization_id: string;
  email: string;
  role: InvitableRole;
  status: InvitationStatus;
  created_at: string;
  expires_at: string;
  accepted_at: string | null;
  revoked_at: string | null;
}

/** Explicit column list — never `select *`, which would pull in `token_hash`. */
export const INVITATION_COLUMNS =
  "id, organization_id, email, role, status, created_at, expires_at, accepted_at, revoked_at";

/**
 * What the invitation landing page may learn BEFORE anyone signs in or accepts.
 * Deliberately minimal: enough to decide whether to accept, and nothing that
 * would make a leaked link useful for reconnaissance. The email is masked.
 */
export type InvitationPreview =
  | {
      state: "valid";
      organization_name: string;
      role: InvitableRole;
      email_masked: string;
      expires_at: string;
    }
  | { state: "invalid" | "expired" | "revoked" | "accepted" };

/** Result of creating an invitation. The raw token is returned exactly once. */
export type CreateInvitationResult =
  | {
      ok: true;
      invitation: OrganizationInvitation;
      /**
       * The single copyable invite link. Built from the raw token, which is not
       * stored anywhere and cannot be recovered after this response — reissue
       * the invitation instead.
       */
      inviteUrl: string;
    }
  | { ok: false; error: InvitationErrorKey };

/** Result of accepting an invitation. Mirrors `accept_invitation()`'s states. */
export type AcceptInvitationResult =
  | { state: "ok"; organization_id: string }
  | {
      state:
        | "not_authenticated"
        | "invalid"
        | "expired"
        | "revoked"
        | "accepted"
        | "email_mismatch"
        | "already_member"
        | "failed";
    };

/** Translation keys under `organization.team.errors`. */
export type InvitationErrorKey =
  | "notAuthorized"
  | "personalWorkspace"
  | "invalidEmail"
  | "invalidRole"
  | "alreadyMember"
  | "duplicatePending"
  | "linkUnavailable"
  | "saveFailed";

/** Translation keys under `organization.team.errors` for member management. */
export type MemberErrorKey =
  | "notAuthorized"
  | "invalidRole"
  | "memberNotFound"
  | "lastOwner"
  | "cannotManageOwner"
  | "saveFailed";

export type MemberActionResult =
  | { ok: true }
  | { ok: false; error: MemberErrorKey };

// -----------------------------------------------------------------------------
// Invitation validation
// -----------------------------------------------------------------------------
export const invitationInputSchema = z.object({
  email: z
    .string({ error: "invalidEmail" })
    .trim()
    .toLowerCase()
    .pipe(z.email({ error: "invalidEmail" }).max(200, { error: "invalidEmail" })),
  role: z.enum(INVITABLE_ROLES, { error: "invalidRole" }),
});

export type InvitationInput = z.infer<typeof invitationInputSchema>;

/** Role change targets. Only an owner may pick `owner` — enforced server-side. */
export const memberRoleChangeSchema = z.object({
  memberId: z.uuid({ error: "memberNotFound" }),
  role: z.enum(ORG_ROLES, { error: "invalidRole" }),
});

// -----------------------------------------------------------------------------
// Validation
// -----------------------------------------------------------------------------
// Error messages are translation keys (resolved under `organization.form.errors`).
const emptyToUndefined = (v: unknown) =>
  typeof v === "string" && v.trim() === "" ? undefined : v;

const optionalText = (max: number) =>
  z.preprocess(
    emptyToUndefined,
    z.string().trim().max(max, { error: "tooLong" }).optional(),
  );

export const organizationInputSchema = z.object({
  name: z
    .string({ error: "required" })
    .trim()
    .min(1, { error: "required" })
    .max(120, { error: "tooLong" }),
  business_type: optionalText(80),
  contact_name: optionalText(120),
  phone: optionalText(40),
  email: z.preprocess(
    emptyToUndefined,
    z.email({ error: "invalidEmail" }).max(200, { error: "tooLong" }).optional(),
  ),
});

export type OrganizationInput = z.infer<typeof organizationInputSchema>;

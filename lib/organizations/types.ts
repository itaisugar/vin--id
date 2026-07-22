import * as z from "zod";

// -----------------------------------------------------------------------------
// Roles
// -----------------------------------------------------------------------------
/**
 * Phase 1 role model — deliberately flat. No custom roles, no permission
 * matrix, no multi-org membership: one user belongs to one organization with
 * one role.
 *
 *   owner         full access, including organization settings
 *   admin         full operational access + organization settings
 *   fleet_manager manages vehicles and fleet operations, not org settings
 *   viewer        read-only
 */
export const ORG_ROLES = ["owner", "admin", "fleet_manager", "viewer"] as const;
export type OrgRole = (typeof ORG_ROLES)[number];

/** Roles allowed to create/update/delete fleet data. Mirrors `is_org_writer()`. */
export const WRITER_ROLES: readonly OrgRole[] = [
  "owner",
  "admin",
  "fleet_manager",
];

/** Roles allowed to change organization settings. Mirrors the org RLS policy. */
export const ORG_ADMIN_ROLES: readonly OrgRole[] = ["owner", "admin"];

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

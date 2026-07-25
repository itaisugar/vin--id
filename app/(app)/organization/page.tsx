import { getTranslations } from "next-intl/server";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { InvitationList } from "@/components/organization/invitation-list";
import { InviteForm } from "@/components/organization/invite-form";
import { MemberList } from "@/components/organization/member-list";
import { RoleBadge } from "@/components/organization/role-badge";
import { listPendingInvitations } from "@/lib/organizations/invitations";
import { listOrganizationMembers } from "@/lib/organizations/members";
import { getCurrentUserContext } from "@/lib/organizations/service";
import { canManageOrganization } from "@/lib/organizations/types";

/**
 * Organization team screen.
 *
 * The roster and invitations are owner/admin only — a fleet manager or viewer
 * sees the organization name and their own role, and nothing else. That is
 * enforced in the database (the `list_organization_members()` RPC and the
 * invitation RLS policies both require `is_org_admin()`), in the service layer,
 * and again here so the management UI is never even rendered.
 */
export default async function OrganizationPage() {
  const t = await getTranslations("organization.team");

  const context = await getCurrentUserContext();

  // No membership: the profile cache alone never grants access to this screen.
  if (!context?.membership || !context.effectiveRole) {
    return (
      <div className="mx-auto max-w-2xl space-y-6">
        <h1 className="text-2xl font-extrabold tracking-tight">{t("title")}</h1>
        <Card>
          <CardContent className="py-8 text-center text-sm text-ink-2">
            {t("noOrganization")}
          </CardContent>
        </Card>
      </div>
    );
  }

  const role = context.effectiveRole;
  const canManage = canManageOrganization(role);

  // `listPendingInvitations` applies the expiry cutoff server-side, so this
  // component stays pure (no clock read during render).
  const [members, pending] = canManage
    ? await Promise.all([listOrganizationMembers(), listPendingInvitations()])
    : [[], []];

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-extrabold tracking-tight">{t("title")}</h1>
        <p className="text-sm text-ink-2">{t("subtitle")}</p>
      </div>

      {/* Organization identity + the caller's own role */}
      <Card className="p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-lg font-bold">
              {context.organizationName ?? t("untitledOrganization")}
            </p>
            <p className="text-sm text-ink-2">{t("yourRole")}</p>
          </div>
          <RoleBadge role={role} />
        </div>
      </Card>

      {canManage ? (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t("members.title")}</CardTitle>
            </CardHeader>
            <CardContent>
              <MemberList
                members={members}
                currentUserId={context.profile.id}
                currentRole={role}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="space-y-1">
              <CardTitle className="text-base">{t("invite.title")}</CardTitle>
              <p className="text-sm text-ink-2">{t("invite.help")}</p>
            </CardHeader>
            <CardContent>
              <InviteForm />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                {t("invitations.title")}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <InvitationList invitations={pending} />
            </CardContent>
          </Card>
        </>
      ) : (
        <Card>
          <CardContent className="py-8 text-center text-sm text-ink-2">
            {t("readOnlyNotice")}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

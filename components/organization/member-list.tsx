"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import {
  changeMemberRoleAction,
  removeMemberAction,
} from "@/app/(app)/organization/actions";
import { RoleBadge } from "@/components/organization/role-badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Select } from "@/components/ui/select";
import {
  ORG_ROLES,
  type OrganizationMemberListItem,
  type OrgRole,
} from "@/lib/organizations/types";

/**
 * Member roster with inline role changes and removal.
 *
 * The controls shown here mirror the server rules rather than defining them:
 * an admin never sees a control that targets an owner, and no one sees a
 * control that would strip the last owner. Both are re-enforced by the service
 * layer and by the database, so hiding a button is a convenience, not a
 * security boundary.
 */
export function MemberList({
  members,
  currentUserId,
  currentRole,
}: {
  members: OrganizationMemberListItem[];
  currentUserId: string;
  currentRole: OrgRole;
}) {
  const t = useTranslations("organization.team");
  const tErrors = useTranslations("organization.team.errors");
  const tRoles = useTranslations("organization.roles");

  const [pendingId, setPendingId] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [confirmTarget, setConfirmTarget] =
    React.useState<OrganizationMemberListItem | null>(null);
  const [isPending, startTransition] = React.useTransition();

  const ownerCount = members.filter((m) => m.role === "owner").length;
  const isOwner = currentRole === "owner";

  /** An admin may not manage owners; only an owner may. */
  const canManageMember = (member: OrganizationMemberListItem) =>
    isOwner || member.role !== "owner";

  /** The final owner may be neither demoted nor removed while the org lives. */
  const isLastOwner = (member: OrganizationMemberListItem) =>
    member.role === "owner" && ownerCount <= 1;

  const assignableRoles = (member: OrganizationMemberListItem): OrgRole[] =>
    ORG_ROLES.filter((role) => {
      // Only an owner may grant ownership.
      if (role === "owner" && !isOwner) return false;
      // The last owner cannot be moved off the owner role.
      if (isLastOwner(member) && role !== "owner") return false;
      return true;
    });

  function onRoleChange(member: OrganizationMemberListItem, role: string) {
    setError(null);
    setNotice(null);
    setPendingId(member.id);
    startTransition(async () => {
      const result = await changeMemberRoleAction(member.id, role);
      setPendingId(null);
      if (result.error) setError(tErrors(result.error));
      else setNotice(t("members.roleUpdated"));
    });
  }

  function onRemoveConfirmed() {
    const member = confirmTarget;
    if (!member) return;
    setError(null);
    setNotice(null);
    setPendingId(member.id);
    startTransition(async () => {
      const result = await removeMemberAction(member.id);
      setPendingId(null);
      setConfirmTarget(null);
      if (result.error) setError(tErrors(result.error));
      else setNotice(t("members.removed"));
    });
  }

  if (members.length === 0) {
    return <p className="py-4 text-sm text-ink-2">{t("members.empty")}</p>;
  }

  return (
    <div className="space-y-3">
      {error ? (
        <p role="alert" className="text-sm font-medium text-danger">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p role="status" className="text-sm font-medium text-ok">
          {notice}
        </p>
      ) : null}

      <ul className="divide-y divide-line">
        {members.map((member) => {
          const manageable = canManageMember(member);
          const busy = isPending && pendingId === member.id;
          const isSelf = member.user_id === currentUserId;

          return (
            <li
              key={member.id}
              className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">
                  {member.full_name?.trim() || member.email || "—"}
                  {isSelf ? (
                    <span className="ms-2 text-xs text-ink-2">
                      {t("members.you")}
                    </span>
                  ) : null}
                </p>
                {/* dir=ltr keeps addresses readable in an RTL layout. */}
                <p className="truncate text-sm text-ink-2" dir="ltr">
                  {member.email ?? "—"}
                </p>
              </div>

              <div className="flex items-center gap-2">
                {manageable ? (
                  <>
                    <label className="sr-only" htmlFor={`role-${member.id}`}>
                      {t("members.roleLabel")}
                    </label>
                    <Select
                      id={`role-${member.id}`}
                      className="h-9 w-auto min-w-[9.5rem] text-xs"
                      value={member.role}
                      disabled={busy || isLastOwner(member)}
                      onChange={(e) => onRoleChange(member, e.target.value)}
                    >
                      {assignableRoles(member).map((role) => (
                        <option key={role} value={role}>
                          {tRoles(role)}
                        </option>
                      ))}
                    </Select>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={busy || isLastOwner(member)}
                      onClick={() => setConfirmTarget(member)}
                    >
                      {t("members.remove")}
                    </Button>
                  </>
                ) : (
                  <RoleBadge role={member.role} />
                )}
              </div>
            </li>
          );
        })}
      </ul>

      <ConfirmDialog
        open={confirmTarget !== null}
        title={t("members.confirmRemoveTitle")}
        description={t("members.confirmRemoveBody", {
          name:
            confirmTarget?.full_name?.trim() ||
            confirmTarget?.email ||
            t("members.thisMember"),
        })}
        confirmLabel={t("members.remove")}
        cancelLabel={t("cancel")}
        pending={isPending}
        pendingLabel={t("members.removing")}
        onConfirm={onRemoveConfirmed}
        onCancel={() => setConfirmTarget(null)}
      />
    </div>
  );
}

"use client";

import * as React from "react";
import { useFormatter, useTranslations } from "next-intl";
import { revokeInvitationAction } from "@/app/(app)/organization/actions";
import { RoleBadge } from "@/components/organization/role-badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import type { OrganizationInvitation } from "@/lib/organizations/types";

/**
 * Pending invitations.
 *
 * Only the invited address, the offered role and the expiry are shown — the
 * link itself is unrecoverable after creation, by design, so there is no
 * "copy again" affordance. Revoking is the way to invalidate a lost link.
 */
export function InvitationList({
  invitations,
}: {
  invitations: OrganizationInvitation[];
}) {
  const t = useTranslations("organization.team.invitations");
  const tErrors = useTranslations("organization.team.errors");
  const tTeam = useTranslations("organization.team");
  const format = useFormatter();

  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [confirmTarget, setConfirmTarget] =
    React.useState<OrganizationInvitation | null>(null);
  const [isPending, startTransition] = React.useTransition();

  function onRevokeConfirmed() {
    const invitation = confirmTarget;
    if (!invitation) return;
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const result = await revokeInvitationAction(invitation.id);
      setConfirmTarget(null);
      if (result.error) setError(tErrors(result.error));
      else setNotice(t("revoked"));
    });
  }

  if (invitations.length === 0) {
    return (
      <>
        {notice ? (
          <p role="status" className="text-sm font-medium text-ok">
            {notice}
          </p>
        ) : null}
        <p className="py-4 text-sm text-ink-2">{t("empty")}</p>
      </>
    );
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
        {invitations.map((invitation) => (
          <li
            key={invitation.id}
            className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium" dir="ltr">
                {invitation.email}
              </p>
              <p className="text-sm text-ink-2">
                {t("expiresAt", {
                  date: format.dateTime(new Date(invitation.expires_at), {
                    dateStyle: "medium",
                  }),
                })}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <RoleBadge role={invitation.role} />
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={isPending}
                onClick={() => setConfirmTarget(invitation)}
              >
                {t("revoke")}
              </Button>
            </div>
          </li>
        ))}
      </ul>

      <ConfirmDialog
        open={confirmTarget !== null}
        title={t("confirmRevokeTitle")}
        description={t("confirmRevokeBody", {
          email: confirmTarget?.email ?? "",
        })}
        confirmLabel={t("revoke")}
        cancelLabel={tTeam("cancel")}
        pending={isPending}
        pendingLabel={t("revoking")}
        onConfirm={onRevokeConfirmed}
        onCancel={() => setConfirmTarget(null)}
      />
    </div>
  );
}

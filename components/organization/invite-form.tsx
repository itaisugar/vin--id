"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { createInvitationAction } from "@/app/(app)/organization/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { copyToClipboard } from "@/lib/clipboard";
import { INVITABLE_ROLES, type InvitableRole } from "@/lib/organizations/types";

/**
 * Invite form.
 *
 * The generated link is shown ONCE, in memory, after a successful create — it
 * is never written to localStorage, sessionStorage or a cookie, and the raw
 * token exists nowhere else (the database holds only its hash). Navigating away
 * loses it, which is why the copy affordance is prominent and the help text
 * says the invitation must be reissued if the link is lost.
 */
export function InviteForm() {
  const t = useTranslations("organization.team.invite");
  const tErrors = useTranslations("organization.team.errors");
  const tRoles = useTranslations("organization.roles");

  const [email, setEmail] = React.useState("");
  const [role, setRole] = React.useState<InvitableRole>("fleet_manager");
  const [error, setError] = React.useState<string | null>(null);
  const [result, setResult] = React.useState<{
    inviteUrl: string;
    email: string;
  } | null>(null);
  const [copied, setCopied] = React.useState(false);
  const [isPending, startTransition] = React.useTransition();

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setResult(null);
    setCopied(false);

    startTransition(async () => {
      const state = await createInvitationAction({ email, role });
      if (state.error) {
        setError(tErrors(state.error));
        return;
      }
      if (state.inviteUrl && state.email) {
        setResult({ inviteUrl: state.inviteUrl, email: state.email });
        setEmail("");
      }
    });
  }

  async function onCopy() {
    if (!result) return;
    const ok = await copyToClipboard(result.inviteUrl);
    setCopied(ok);
    if (!ok) setError(tErrors("copyFailed"));
  }

  return (
    <div className="space-y-4">
      <form onSubmit={onSubmit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="invite-email">{t("emailLabel")}</Label>
          <Input
            id="invite-email"
            type="email"
            required
            autoComplete="off"
            // Addresses stay LTR even in a Hebrew layout.
            dir="ltr"
            placeholder={t("emailPlaceholder")}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={isPending}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="invite-role">{t("roleLabel")}</Label>
          <Select
            id="invite-role"
            value={role}
            disabled={isPending}
            onChange={(e) => setRole(e.target.value as InvitableRole)}
          >
            {INVITABLE_ROLES.map((value) => (
              <option key={value} value={value}>
                {tRoles(value)}
              </option>
            ))}
          </Select>
          <p className="text-xs text-ink-2">{t("roleHelp")}</p>
        </div>

        {error ? (
          <p role="alert" className="text-sm font-medium text-danger">
            {error}
          </p>
        ) : null}

        <Button type="submit" disabled={isPending || email.trim() === ""}>
          {isPending ? t("creating") : t("submit")}
        </Button>
      </form>

      {result ? (
        <div
          role="status"
          className="space-y-3 rounded-xl border border-ok/30 bg-ok/8 p-4"
        >
          <p className="text-sm font-semibold text-ok">
            {t("created", { email: result.email })}
          </p>
          <p className="text-xs text-ink-2">{t("copyOnce")}</p>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <code
              dir="ltr"
              className="min-w-0 flex-1 truncate rounded-lg bg-surface-2 px-3 py-2 text-xs"
            >
              {result.inviteUrl}
            </code>
            <Button type="button" variant="outline" size="sm" onClick={onCopy}>
              {copied ? t("copied") : t("copy")}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { acceptInvitationAction } from "@/app/invite/[token]/actions";
import { Button } from "@/components/ui/button";
import type { AcceptInvitationResult } from "@/lib/organizations/types";

/**
 * The explicit Accept step for a signed-in recipient.
 *
 * Nothing happens until the button is pressed — there is no effect that accepts
 * on mount. The token is held in a prop for the lifetime of the page and is not
 * persisted to any browser storage.
 */
export function AcceptInvitation({
  token,
  signedInEmail,
}: {
  token: string;
  signedInEmail: string;
}) {
  const t = useTranslations("invite");
  const router = useRouter();

  const [result, setResult] = React.useState<AcceptInvitationResult | null>(
    null,
  );
  const [isPending, startTransition] = React.useTransition();

  function onAccept() {
    startTransition(async () => {
      const state = await acceptInvitationAction(token);
      setResult(state);
      if (state.state === "ok") {
        router.refresh();
      }
    });
  }

  if (result?.state === "ok") {
    return (
      <div role="status" className="space-y-4 text-center">
        <p className="text-sm font-semibold text-ok">{t("states.success.title")}</p>
        <p className="text-sm text-ink-2">{t("states.success.body")}</p>
        <Link
          href="/dashboard"
          className="inline-flex h-11 w-full items-center justify-center rounded-xl bg-accent px-4 text-sm font-bold text-on-accent glow-accent"
        >
          {t("goToApp")}
        </Link>
      </div>
    );
  }

  // Any non-ok outcome maps to a dedicated explanation rather than a generic
  // failure, so the recipient knows whether to switch account or ask for a new
  // link.
  const failureKey = result ? result.state : null;

  return (
    <div className="space-y-4">
      <p className="text-center text-sm text-ink-2">
        {t("signedInAs")}{" "}
        <span dir="ltr" className="font-medium text-ink">
          {signedInEmail}
        </span>
      </p>

      {failureKey ? (
        <div role="alert" className="space-y-2 text-center">
          <p className="text-sm font-semibold text-danger">
            {t(`states.${failureKey}.title`)}
          </p>
          <p className="text-sm text-ink-2">{t(`states.${failureKey}.body`)}</p>
          {failureKey === "email_mismatch" ? (
            <Link
              href="/login"
              className="inline-block pt-1 text-sm font-medium text-accent underline"
            >
              {t("switchAccount")}
            </Link>
          ) : null}
        </div>
      ) : null}

      {failureKey === null || failureKey === "failed" ? (
        <Button
          type="button"
          className="w-full"
          disabled={isPending}
          onClick={onAccept}
        >
          {isPending ? t("accepting") : t("accept")}
        </Button>
      ) : null}
    </div>
  );
}

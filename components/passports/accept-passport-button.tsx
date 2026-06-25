"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { acceptPassportAction } from "@/app/p/[token]/actions";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

/** Buyer-side "Accept Passport" with a confirmation dialog. */
export function AcceptPassportButton({ token }: { token: string }) {
  const t = useTranslations("passports.accept");
  const [open, setOpen] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [isPending, startTransition] = React.useTransition();

  const onConfirm = () => {
    setError(null);
    startTransition(async () => {
      // On success this redirects to the new vehicle; only returns on failure.
      const result = await acceptPassportAction(token);
      if (result?.error) setError(result.error);
    });
  };

  return (
    <div className="flex flex-col items-center gap-2">
      <Button type="button" onClick={() => setOpen(true)}>
        {t("acceptCta")}
      </Button>
      <p className="text-xs text-muted-foreground">{t("notOfficial")}</p>
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {t(`errors.${error}`)}
        </p>
      ) : null}

      <ConfirmDialog
        open={open}
        title={t("confirmTitle")}
        description={t("confirmBody")}
        confirmLabel={t("confirm")}
        cancelLabel={t("cancel")}
        pending={isPending}
        pendingLabel={t("pending")}
        onConfirm={onConfirm}
        onCancel={() => setOpen(false)}
      />
    </div>
  );
}

"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { revokePassportAction } from "@/app/(app)/vehicles/[id]/passports/actions";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

export function RevokePassportButton({
  vehicleId,
  passportId,
}: {
  vehicleId: string;
  passportId: string;
}) {
  const t = useTranslations("passports");
  const [open, setOpen] = React.useState(false);
  const [error, setError] = React.useState(false);
  const [isPending, startTransition] = React.useTransition();

  const onConfirm = () => {
    setError(false);
    startTransition(async () => {
      const result = await revokePassportAction(vehicleId, passportId);
      if (result?.error) {
        setError(true);
        return;
      }
      setOpen(false);
    });
  };

  return (
    <>
      <Button
        type="button"
        variant="outline"
        onClick={() => {
          setError(false);
          setOpen(true);
        }}
      >
        {t("revoke.action")}
      </Button>

      <ConfirmDialog
        open={open}
        title={t("revoke.title")}
        description={error ? t("errors.revokeFailed") : t("revoke.description")}
        confirmLabel={t("revoke.confirm")}
        cancelLabel={t("revoke.cancel")}
        pending={isPending}
        pendingLabel={t("revoke.pending")}
        onConfirm={onConfirm}
        onCancel={() => setOpen(false)}
      />
    </>
  );
}

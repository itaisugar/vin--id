"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { deleteMaintenanceAction } from "@/app/(app)/vehicles/[id]/maintenance/actions";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

export function DeleteMaintenanceButton({
  vehicleId,
  logId,
}: {
  vehicleId: string;
  logId: string;
}) {
  const t = useTranslations("maintenance");
  const [open, setOpen] = React.useState(false);
  const [error, setError] = React.useState(false);
  const [isPending, startTransition] = React.useTransition();

  const onConfirm = () => {
    setError(false);
    startTransition(async () => {
      const result = await deleteMaintenanceAction(vehicleId, logId);
      if (result?.error) {
        setError(true);
        return; // keep the dialog open and show the failure
      }
      setOpen(false);
    });
  };

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => {
          setError(false);
          setOpen(true);
        }}
      >
        {t("delete.action")}
      </Button>

      <ConfirmDialog
        open={open}
        title={t("delete.title")}
        description={error ? t("form.errors.deleteFailed") : t("delete.description")}
        confirmLabel={t("delete.confirm")}
        cancelLabel={t("form.cancel")}
        pending={isPending}
        pendingLabel={t("delete.pending")}
        onConfirm={onConfirm}
        onCancel={() => setOpen(false)}
      />
    </>
  );
}

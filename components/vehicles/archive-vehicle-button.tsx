"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { archiveVehicleAction } from "@/app/(app)/vehicles/actions";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

export function ArchiveVehicleButton({ vehicleId }: { vehicleId: string }) {
  const t = useTranslations("vehicles");
  const [open, setOpen] = React.useState(false);
  const [isPending, startTransition] = React.useTransition();

  const onConfirm = () => {
    startTransition(async () => {
      // On success this redirects to /vehicles; only returns on failure.
      await archiveVehicleAction(vehicleId);
      setOpen(false);
    });
  };

  return (
    <>
      <Button
        type="button"
        variant="outline"
        onClick={() => setOpen(true)}
      >
        {t("archive.action")}
      </Button>

      <ConfirmDialog
        open={open}
        title={t("archive.title")}
        description={t("archive.description")}
        confirmLabel={t("archive.confirm")}
        cancelLabel={t("form.cancel")}
        pending={isPending}
        pendingLabel={t("archive.pending")}
        onConfirm={onConfirm}
        onCancel={() => setOpen(false)}
      />
    </>
  );
}

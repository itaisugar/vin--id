"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { deleteDocumentAction } from "@/app/(app)/vehicles/[id]/documents/actions";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

export function DeleteDocumentButton({
  vehicleId,
  documentId,
}: {
  vehicleId: string;
  documentId: string;
}) {
  const t = useTranslations("documents");
  const [open, setOpen] = React.useState(false);
  const [error, setError] = React.useState(false);
  const [isPending, startTransition] = React.useTransition();

  const onConfirm = () => {
    setError(false);
    startTransition(async () => {
      const result = await deleteDocumentAction(vehicleId, documentId);
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

"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { logout } from "@/app/(auth)/actions";
import { LogoutIcon } from "@/components/icons";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { cn } from "@/lib/utils";

export function LogoutButton({ className }: { className?: string }) {
  const t = useTranslations("auth");
  const [open, setOpen] = React.useState(false);
  const [isPending, startTransition] = React.useTransition();

  const onConfirm = () => {
    startTransition(async () => {
      await logout();
    });
  };

  return (
    <>
      <button
        type="button"
        disabled={isPending}
        onClick={() => setOpen(true)}
        className={cn(
          "inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted disabled:opacity-50",
          className,
        )}
      >
        <LogoutIcon className="h-5 w-5" />
        <span>{isPending ? t("signingOut") : t("signOut")}</span>
      </button>
      <ConfirmDialog
        open={open}
        title={t("signOutConfirm.title")}
        description={t("signOutConfirm.body")}
        confirmLabel={t("signOutConfirm.confirm")}
        cancelLabel={t("signOutConfirm.cancel")}
        pending={isPending}
        pendingLabel={t("signingOut")}
        onConfirm={onConfirm}
        onCancel={() => setOpen(false)}
      />
    </>
  );
}

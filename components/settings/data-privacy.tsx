"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { requestAccountDeletionAction } from "@/app/(app)/settings/actions";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

const EXPORTS = [
  { key: "exportJson", href: "/api/account/export/json" },
  { key: "exportMaintenance", href: "/api/account/export/maintenance.csv" },
  { key: "exportIssues", href: "/api/account/export/issues.csv" },
] as const;

/**
 * Settings → Data & privacy. Export links are plain authenticated GET downloads
 * (cookie-based). The deletion control records a *request* only — no data is
 * deleted here.
 */
export function DataPrivacySection() {
  const t = useTranslations("settings.dataPrivacy");
  const [open, setOpen] = React.useState(false);
  const [done, setDone] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [isPending, startTransition] = React.useTransition();

  const onConfirm = () => {
    setError(null);
    startTransition(async () => {
      const pageUrl =
        typeof window !== "undefined" ? window.location.href : undefined;
      const result = await requestAccountDeletionAction(pageUrl);
      if (result?.error) {
        setError(result.error);
        return;
      }
      setDone(true);
      setOpen(false);
    });
  };

  return (
    <div className="space-y-5">
      <p className="text-sm text-muted-foreground">{t("intro")}</p>

      {/* Exports */}
      <div className="space-y-2">
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          {EXPORTS.map(({ key, href }) => (
            <a
              key={key}
              href={href}
              download
              className="inline-flex h-10 w-full items-center justify-center rounded-md border border-border px-4 text-sm font-medium transition-colors hover:bg-muted sm:w-auto"
            >
              {t(key)}
            </a>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">{t("exportHelp")}</p>
        <p className="rounded-md bg-amber-500/15 p-2 text-xs font-medium text-amber-700 dark:text-amber-400">
          ⚠️ {t("exportWarning")}
        </p>
      </div>

      {/* Account deletion (request only) */}
      <div className="space-y-2 border-t border-border pt-4">
        <h3 className="text-sm font-semibold">{t("deletion.title")}</h3>
        <p className="text-sm text-muted-foreground">{t("deletion.body")}</p>
        {done ? (
          <p
            role="status"
            className="rounded-md border border-border bg-muted p-3 text-sm"
          >
            {t("deletion.done")}
          </p>
        ) : (
          <Button
            type="button"
            variant="outline"
            onClick={() => setOpen(true)}
            disabled={isPending}
            className="w-full sm:w-auto"
          >
            {t("deletion.request")}
          </Button>
        )}
        {error ? (
          <p role="alert" className="text-sm text-red-600">
            {t("deletion.error")}
          </p>
        ) : null}
      </div>

      <ConfirmDialog
        open={open}
        title={t("deletion.confirmTitle")}
        description={t("deletion.confirmBody")}
        confirmLabel={t("deletion.confirm")}
        cancelLabel={t("deletion.cancel")}
        pending={isPending}
        pendingLabel={t("deletion.pending")}
        onConfirm={onConfirm}
        onCancel={() => setOpen(false)}
      />
    </div>
  );
}

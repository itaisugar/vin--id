"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { resolveIssueAction } from "@/app/(app)/vehicles/[id]/issues/actions";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

/** Quick "mark resolved" action with an optional resolution note. */
export function ResolveIssueButton({
  vehicleId,
  issueId,
}: {
  vehicleId: string;
  issueId: string;
}) {
  const t = useTranslations("issues");
  const [open, setOpen] = React.useState(false);
  const [notes, setNotes] = React.useState("");
  const [error, setError] = React.useState(false);
  const [isPending, startTransition] = React.useTransition();

  const close = () => {
    if (!isPending) {
      setOpen(false);
      setError(false);
      setNotes("");
    }
  };

  const onConfirm = () => {
    setError(false);
    startTransition(async () => {
      const result = await resolveIssueAction(vehicleId, issueId, notes);
      if (result?.error) {
        setError(true);
        return;
      }
      setOpen(false);
      setNotes("");
    });
  };

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
      >
        {t("resolve.action")}
      </Button>

      {open ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="resolve-dialog-title"
        >
          <button
            type="button"
            aria-label={t("form.cancel")}
            className="absolute inset-0 bg-black/50"
            onClick={close}
          />
          <div className="relative w-full max-w-sm rounded-lg border border-border bg-background p-5 shadow-lg">
            <h2 id="resolve-dialog-title" className="text-lg font-semibold">
              {t("resolve.title")}
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              {t("resolve.description")}
            </p>
            <div className="mt-4 space-y-1.5">
              <Label htmlFor="resolve-notes">
                {t("resolve.notesLabel")}
              </Label>
              <Textarea
                id="resolve-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder={t("resolve.notesPlaceholder")}
              />
            </div>
            {error ? (
              <p role="alert" className="mt-2 text-sm text-danger">
                {t("form.errors.resolveFailed")}
              </p>
            ) : null}
            <div className="mt-5 flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={close}
                disabled={isPending}
              >
                {t("form.cancel")}
              </Button>
              <Button type="button" onClick={onConfirm} disabled={isPending}>
                {isPending ? t("resolve.pending") : t("resolve.confirm")}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { saveAsIssueAction } from "@/app/(app)/diagnose/actions";
import { Button } from "@/components/ui/button";

export function SaveAsIssueButton({ sessionId }: { sessionId: string }) {
  const t = useTranslations("diagnose");
  const [error, setError] = React.useState<string | null>(null);
  const [isPending, startTransition] = React.useTransition();

  const onClick = () => {
    setError(null);
    startTransition(async () => {
      // On success this redirects to the vehicle's issues; only returns on error.
      const result = await saveAsIssueAction(sessionId);
      if (result?.error) setError(result.error);
    });
  };

  return (
    <div className="space-y-1">
      <Button type="button" onClick={onClick} disabled={isPending}>
        {isPending ? t("saveIssue.pending") : t("saveIssue.action")}
      </Button>
      {error ? (
        <p role="alert" className="text-sm text-red-600">
          {t(`form.errors.${error}`)}
        </p>
      ) : null}
    </div>
  );
}

"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { extractDocumentAction } from "@/app/(app)/vehicles/[id]/documents/extraction-actions";
import { Button } from "@/components/ui/button";

/** Triggers a server-side MOCK extraction; the review panel appears after. */
export function ExtractWithAiButton({
  vehicleId,
  documentId,
}: {
  vehicleId: string;
  documentId: string;
}) {
  const t = useTranslations("documents.extraction");
  const [error, setError] = React.useState<string | null>(null);
  const [isPending, startTransition] = React.useTransition();

  const onClick = () => {
    setError(null);
    startTransition(async () => {
      const result = await extractDocumentAction(vehicleId, documentId);
      if (result?.error) setError(result.error);
    });
  };

  return (
    <div className="rounded-md border border-dashed border-border p-3">
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={onClick}
        disabled={isPending}
      >
        {isPending ? t("extracting") : t("extract")}
      </Button>
      <p className="mt-2 text-xs text-muted-foreground">{t("mockNotice")}</p>
      {error ? (
        <p role="alert" className="mt-1 text-sm text-red-600">
          {t(`errors.${error}`)}
        </p>
      ) : null}
    </div>
  );
}

"use client";

import { useEffect } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";

/**
 * Error boundary for document intake.
 *
 * Deliberately shows only the generic message: a failure here can originate in
 * the extraction provider, whose error text can echo the contents of the
 * document that was just uploaded. Nothing from `error` is rendered — it goes to
 * the server log, where the message is already sanitized.
 *
 * Recovery is safe to offer, because nothing has been saved: an intake that
 * failed created no maintenance, insurance, registration or inspection record.
 */
export default function FleetIntakeError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations("common");
  const ti = useTranslations("fleet.intake");

  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="mx-auto flex max-w-2xl flex-col items-center justify-center gap-4 rounded-2xl border border-line p-12 text-center">
      <p className="font-medium">{t("somethingWentWrong")}</p>
      <p className="max-w-sm text-sm text-ink-2">{ti("nothingSavedYet")}</p>
      <Button variant="outline" onClick={reset}>
        {t("retry")}
      </Button>
    </div>
  );
}

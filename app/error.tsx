"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";

// App-level error boundary (inside the root layout's i18n provider). Catches
// errors not handled by a nested error.tsx. Root-layout errors fall through to
// global-error.tsx.
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations("common.errorPage");

  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-muted/30 p-6 text-center">
      <div className="space-y-1">
        <p className="font-medium">{t("title")}</p>
        <p className="max-w-sm text-sm text-muted-foreground">{t("body")}</p>
      </div>
      <div className="flex gap-2">
        <Button type="button" onClick={reset}>
          {t("retry")}
        </Button>
        <Link
          href="/"
          className="inline-flex h-10 items-center justify-center rounded-md border border-border px-4 text-sm font-medium transition-colors hover:bg-muted"
        >
          {t("home")}
        </Link>
      </div>
    </div>
  );
}

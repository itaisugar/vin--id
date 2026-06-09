import Link from "next/link";
import { getTranslations } from "next-intl/server";

// Root 404 — rendered inside the root layout, so it has i18n + RTL.
export default async function NotFound() {
  const t = await getTranslations("common.notFound");

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-muted/30 p-6 text-center">
      <p className="text-3xl font-bold">404</p>
      <div className="space-y-1">
        <p className="font-medium">{t("title")}</p>
        <p className="max-w-sm text-sm text-muted-foreground">{t("body")}</p>
      </div>
      <Link
        href="/"
        className="inline-flex h-10 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:opacity-90"
      >
        {t("home")}
      </Link>
    </div>
  );
}

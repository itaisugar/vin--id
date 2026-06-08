import Link from "next/link";
import { getTranslations } from "next-intl/server";

export default async function VehicleNotFound() {
  const t = await getTranslations("vehicles");

  return (
    <div className="flex flex-col items-center justify-center gap-4 rounded-lg border border-dashed border-border p-12 text-center">
      <p className="font-medium">{t("notFound.title")}</p>
      <p className="max-w-sm text-sm text-muted-foreground">
        {t("notFound.body")}
      </p>
      <Link
        href="/vehicles"
        className="inline-flex h-10 items-center justify-center rounded-md border border-border px-4 text-sm font-medium transition-colors hover:bg-muted"
      >
        {t("notFound.back")}
      </Link>
    </div>
  );
}

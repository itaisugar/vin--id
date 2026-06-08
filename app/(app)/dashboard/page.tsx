import { getTranslations } from "next-intl/server";
import { createClient } from "@/lib/supabase/server";
import { CarIcon } from "@/components/icons";

export default async function DashboardPage() {
  const t = await getTranslations("dashboard");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-bold">{t("title")}</h1>
        {user?.email ? (
          <p className="text-muted-foreground">
            {t("welcome", { email: user.email })}
          </p>
        ) : null}
        <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
      </div>

      {/* Placeholder empty state — vehicles/records arrive in later phases. */}
      <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border p-12 text-center">
        <CarIcon className="h-10 w-10 text-muted-foreground" />
        <div className="space-y-1">
          <p className="font-medium">{t("emptyTitle")}</p>
          <p className="max-w-sm text-sm text-muted-foreground">
            {t("emptyBody")}
          </p>
        </div>
        <span className="rounded-full bg-muted px-3 py-1 text-xs font-medium text-muted-foreground">
          {t("comingSoon")}
        </span>
      </div>
    </div>
  );
}

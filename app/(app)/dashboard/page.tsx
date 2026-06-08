import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { createClient } from "@/lib/supabase/server";
import { DashboardReminders } from "@/components/reminders/dashboard-reminders";

export default async function DashboardPage() {
  const t = await getTranslations("dashboard");
  const td = await getTranslations("diagnose");

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

      {/* Diagnose CTA (Phase 4A) */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-background p-4">
        <div className="space-y-0.5">
          <p className="text-sm font-medium">{td("dashboardCta.title")}</p>
          <p className="text-xs text-muted-foreground">
            {td("dashboardCta.body")}
          </p>
        </div>
        <Link
          href="/diagnose"
          className="inline-flex h-10 shrink-0 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:opacity-90"
        >
          {td("dashboardCta.action")}
        </Link>
      </div>

      {/* Upcoming/urgent reminders across the user's active vehicles (Phase 2F) */}
      <DashboardReminders />
    </div>
  );
}

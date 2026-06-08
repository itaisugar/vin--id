import { getTranslations } from "next-intl/server";
import { createClient } from "@/lib/supabase/server";
import { DashboardReminders } from "@/components/reminders/dashboard-reminders";

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

      {/* Upcoming/urgent reminders across the user's active vehicles (Phase 2F) */}
      <DashboardReminders />
    </div>
  );
}

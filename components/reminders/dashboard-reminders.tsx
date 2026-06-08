import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { UrgencyBadge } from "@/components/reminders/urgency-badge";
import { listActiveRemindersForUser } from "@/lib/reminders/service";
import { compareUrgency, deriveEffectiveUrgency } from "@/lib/reminders/types";

const DASHBOARD_LIMIT = 5;

/** Next urgent/upcoming reminders across all of the user's active vehicles. */
export async function DashboardReminders() {
  const t = await getTranslations("reminders");
  const locale = await getLocale();

  const rows = await listActiveRemindersForUser();

  const ranked = rows
    .map((row) => ({
      ...row,
      effective: deriveEffectiveUrgency(row.reminder, row.vehicle.current_mileage),
    }))
    .sort((a, b) => {
      const byUrgency = compareUrgency(a.effective, b.effective);
      if (byUrgency !== 0) return byUrgency;
      const da = a.reminder.due_date
        ? Date.parse(a.reminder.due_date)
        : Number.POSITIVE_INFINITY;
      const db = b.reminder.due_date
        ? Date.parse(b.reminder.due_date)
        : Number.POSITIVE_INFINITY;
      return da - db;
    })
    .slice(0, DASHBOARD_LIMIT);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
        <CardTitle>{t("dashboard.title")}</CardTitle>
        <Link
          href="/vehicles"
          className="text-sm font-medium text-primary hover:underline"
        >
          {t("dashboard.viewVehicles")}
        </Link>
      </CardHeader>
      <CardContent>
        {ranked.length === 0 ? (
          <p className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            {t("dashboard.empty")}
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {ranked.map(({ reminder, vehicle, effective }) => {
              const vehicleName =
                [vehicle.make, vehicle.model].filter(Boolean).join(" ").trim() ||
                t("dashboard.untitledVehicle");
              const due = reminder.due_date
                ? new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(
                    new Date(reminder.due_date),
                  )
                : null;
              return (
                <li key={reminder.id}>
                  <Link
                    href={`/vehicles/${vehicle.id}/reminders`}
                    className="flex items-center justify-between gap-3 py-3 transition-colors hover:bg-muted"
                  >
                    <div className="min-w-0 flex-1 space-y-0.5">
                      <div className="flex items-center gap-2">
                        <UrgencyBadge urgency={effective} />
                        <span className="truncate text-sm font-medium">
                          {reminder.title}
                        </span>
                      </div>
                      <p className="truncate text-xs text-muted-foreground">
                        {vehicleName}
                        {due ? ` · ${due}` : ""}
                      </p>
                    </div>
                    <span aria-hidden className="text-muted-foreground">
                      →
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

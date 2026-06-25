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
import {
  compareUrgency,
  deriveEffectiveUrgency,
  type Urgency,
} from "@/lib/reminders/types";

const DASHBOARD_LIMIT = 5;

// Leading-edge (inline-start) accent stripe per effective urgency.
const URGENCY_STRIPE: Record<Urgency, string> = {
  red: "border-s-danger",
  orange: "border-s-warn",
  green: "border-s-ok",
};

/** Whole days from now until an ISO date (negative = overdue). */
function daysUntil(iso: string): number {
  const ms = Date.parse(iso) - Date.now();
  return Math.round(ms / 86_400_000);
}

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
          <p className="rounded-xl border border-dashed border-line bg-surface-3 p-6 text-center text-sm text-ink-2">
            {t("dashboard.empty")}
          </p>
        ) : (
          <ul className="space-y-2.5">
            {ranked.map(({ reminder, vehicle, effective }) => {
              const vehicleName =
                [vehicle.make, vehicle.model].filter(Boolean).join(" ").trim() ||
                t("dashboard.untitledVehicle");
              const due = reminder.due_date
                ? new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(
                    new Date(reminder.due_date),
                  )
                : null;
              const countdown = reminder.due_date
                ? new Intl.RelativeTimeFormat(locale, { numeric: "auto" }).format(
                    daysUntil(reminder.due_date),
                    "day",
                  )
                : null;
              return (
                <li key={reminder.id}>
                  <Link
                    href={`/vehicles/${vehicle.id}/reminders`}
                    className={`flex items-center justify-between gap-3 rounded-xl border border-line border-s-4 bg-surface-3 p-3 transition active:scale-[.99] hover:bg-surface-2 ${URGENCY_STRIPE[effective]}`}
                  >
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex items-center gap-2">
                        <UrgencyBadge urgency={effective} />
                        <span className="truncate text-sm font-semibold">
                          {reminder.title}
                        </span>
                      </div>
                      <p className="truncate text-xs text-ink-2">
                        {vehicleName}
                        {due ? (
                          <>
                            {" · "}
                            <span className="num">{due}</span>
                          </>
                        ) : null}
                      </p>
                    </div>
                    {countdown ? (
                      <span className="num shrink-0 text-xs font-semibold text-ink-2">
                        {countdown}
                      </span>
                    ) : (
                      <span aria-hidden className="shrink-0 text-ink-3 rtl:rotate-180">
                        ›
                      </span>
                    )}
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

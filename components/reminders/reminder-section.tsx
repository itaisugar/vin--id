import Link from "next/link";
import { getTranslations } from "next-intl/server";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ReminderListItem } from "@/components/reminders/reminder-list-item";
import {
  ACTIVE_STATUS,
  sortActiveReminders,
  type Reminder,
} from "@/lib/reminders/types";
import type { MileageUnit } from "@/lib/vehicles/types";

const RECENT_LIMIT = 3;

/** Upcoming active reminders shown on the vehicle detail page. */
export async function ReminderSection({
  vehicleId,
  reminders,
  currentMileage,
  mileageUnit,
}: {
  vehicleId: string;
  reminders: Reminder[];
  currentMileage: number | null;
  mileageUnit: MileageUnit;
}) {
  const t = await getTranslations("reminders");

  const active = sortActiveReminders(
    reminders.filter((r) => r.status === ACTIVE_STATUS),
    currentMileage,
  );
  const recent = active.slice(0, RECENT_LIMIT);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
        <CardTitle>{t("title")}</CardTitle>
        <Link
          href={`/vehicles/${vehicleId}/reminders/new`}
          className="inline-flex h-9 shrink-0 items-center justify-center rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground transition-colors hover:opacity-90"
        >
          {t("addReminder")}
        </Link>
      </CardHeader>
      <CardContent className="space-y-3">
        {recent.length === 0 ? (
          <p className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            {t("empty.body")}
          </p>
        ) : (
          <>
            <div className="grid gap-3">
              {recent.map((reminder) => (
                <ReminderListItem
                  key={reminder.id}
                  vehicleId={vehicleId}
                  reminder={reminder}
                  currentMileage={currentMileage}
                  mileageUnit={mileageUnit}
                />
              ))}
            </div>
            <Link
              href={`/vehicles/${vehicleId}/reminders`}
              className="inline-block text-sm font-medium text-primary hover:underline"
            >
              {t("viewAll", { count: active.length })}
            </Link>
          </>
        )}
      </CardContent>
    </Card>
  );
}

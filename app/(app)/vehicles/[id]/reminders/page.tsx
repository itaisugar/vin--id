import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ReminderListItem } from "@/components/reminders/reminder-list-item";
import { listReminders } from "@/lib/reminders/service";
import { ACTIVE_STATUS, sortActiveReminders } from "@/lib/reminders/types";
import { getVehicleById } from "@/lib/vehicles/service";

export default async function RemindersListPage({
  params,
}: PageProps<"/vehicles/[id]/reminders">) {
  const { id } = await params;
  const t = await getTranslations("reminders");

  const vehicle = await getVehicleById(id);
  if (!vehicle) notFound();

  const reminders = await listReminders(id);
  const active = sortActiveReminders(
    reminders.filter((r) => r.status === ACTIVE_STATUS),
    vehicle.current_mileage,
  );
  const inactive = reminders.filter((r) => r.status !== ACTIVE_STATUS);

  const vehicleTitle =
    [vehicle.make, vehicle.model].filter(Boolean).join(" ").trim();

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <Link
            href={`/vehicles/${id}`}
            className="text-sm text-muted-foreground hover:underline"
          >
            ← {vehicleTitle || t("backToVehicle")}
          </Link>
          <h1 className="text-2xl font-bold">{t("title")}</h1>
        </div>
        <Link
          href={`/vehicles/${id}/reminders/new`}
          className="inline-flex h-10 shrink-0 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:opacity-90"
        >
          {t("addReminder")}
        </Link>
      </div>

      {reminders.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border p-12 text-center">
          <p className="font-medium">{t("empty.title")}</p>
          <p className="max-w-sm text-sm text-muted-foreground">
            {t("empty.body")}
          </p>
          <Link
            href={`/vehicles/${id}/reminders/new`}
            className="inline-flex h-10 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:opacity-90"
          >
            {t("addReminder")}
          </Link>
        </div>
      ) : (
        <div className="space-y-8">
          <section className="space-y-3">
            <h2 className="text-sm font-semibold text-muted-foreground">
              {t("sections.active")} ({active.length})
            </h2>
            {active.length > 0 ? (
              <div className="grid gap-3">
                {active.map((reminder) => (
                  <ReminderListItem
                    key={reminder.id}
                    vehicleId={id}
                    reminder={reminder}
                    currentMileage={vehicle.current_mileage}
                    mileageUnit={vehicle.mileage_unit}
                  />
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                {t("sections.noActive")}
              </p>
            )}
          </section>

          {inactive.length > 0 ? (
            <section className="space-y-3">
              <h2 className="text-sm font-semibold text-muted-foreground">
                {t("sections.completedDismissed")} ({inactive.length})
              </h2>
              <div className="grid gap-3">
                {inactive.map((reminder) => (
                  <ReminderListItem
                    key={reminder.id}
                    vehicleId={id}
                    reminder={reminder}
                    currentMileage={vehicle.current_mileage}
                    mileageUnit={vehicle.mileage_unit}
                  />
                ))}
              </div>
            </section>
          ) : null}
        </div>
      )}
    </div>
  );
}

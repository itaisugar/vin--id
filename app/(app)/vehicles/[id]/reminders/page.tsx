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
            className="inline-flex items-center gap-1 text-sm text-ink-2 hover:text-ink"
          >
            <span className="inline-block rtl:rotate-180">←</span> {vehicleTitle || t("backToVehicle")}
          </Link>
          <h1 className="text-2xl font-extrabold tracking-tight">{t("title")}</h1>
        </div>
        <Link
          href={`/vehicles/${id}/reminders/new`}
          className="inline-flex h-10 shrink-0 items-center justify-center rounded-xl bg-accent px-4 text-sm font-semibold text-on-accent transition-transform active:scale-[.98]"
        >
          {t("addReminder")}
        </Link>
      </div>

      {reminders.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-line p-12 text-center">
          <p className="font-medium">{t("empty.title")}</p>
          <p className="max-w-sm text-sm text-ink-2">
            {t("empty.body")}
          </p>
          <Link
            href={`/vehicles/${id}/reminders/new`}
            className="inline-flex h-10 items-center justify-center rounded-xl bg-accent px-4 text-sm font-semibold text-on-accent transition-transform active:scale-[.98]"
          >
            {t("addReminder")}
          </Link>
        </div>
      ) : (
        <div className="space-y-8">
          <section className="space-y-3">
            <h2 className="text-sm font-semibold text-ink-2">
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
              <p className="text-sm text-ink-2">
                {t("sections.noActive")}
              </p>
            )}
          </section>

          {inactive.length > 0 ? (
            <section className="space-y-3">
              <h2 className="text-sm font-semibold text-ink-2">
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

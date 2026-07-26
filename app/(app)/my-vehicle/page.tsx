import { getLocale, getTranslations } from "next-intl/server";
import { DriverDocumentList } from "@/components/drivers/driver-document-list";
import { DriverVehicleCard } from "@/components/drivers/driver-vehicle-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireDriverView } from "@/lib/drivers/guard";
import { getDriverViewData } from "@/lib/drivers/service";

/**
 * Driver View — the whole app, for someone assigned to one vehicle.
 *
 * Every value on this screen comes from a driver-safe RPC. There is no query
 * here that could return a cost, a Storage path or another vehicle, because the
 * underlying tables are closed to drivers entirely; see
 * 20260725220000_driver_rls.sql.
 */
export default async function MyVehiclePage() {
  await requireDriverView();

  const t = await getTranslations("driver");
  const locale = await getLocale();
  const data = await getDriverViewData();

  // No active assignment. This is a normal state, not an error: a driver may be
  // between vehicles, or newly invited and not yet assigned.
  if (!data) {
    return (
      <div className="space-y-6">
        <h1 className="text-xl font-semibold">{t("title")}</h1>
        <Card>
          <CardContent className="space-y-2 p-8 text-center">
            <p className="text-base font-semibold">{t("noAssignment.title")}</p>
            <p className="text-sm text-ink-2">{t("noAssignment.body")}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const { vehicle, maintenance, documents, reminders } = data;
  const fmtDate = (value: string | null) =>
    value
      ? new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(
          new Date(value),
        )
      : "—";

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-xl font-semibold">{t("title")}</h1>
        <p className="text-sm text-ink-2">
          {t("subtitle", { organization: vehicle.organization_name })}
        </p>
      </div>

      <DriverVehicleCard vehicle={vehicle} />

      {/* Reminders a manager deliberately shared. */}
      {reminders.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("reminders.title")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 p-4 pt-0">
            {reminders.map((reminder) => (
              <div
                key={reminder.id}
                className="rounded-xl border border-line bg-surface-2 p-3"
              >
                <p className="text-sm font-medium">{reminder.title}</p>
                {reminder.description ? (
                  <p className="mt-1 text-xs text-ink-2">{reminder.description}</p>
                ) : null}
                <p className="mt-2 text-xs text-ink-3">
                  {t("reminders.due", { date: fmtDate(reminder.due_date) })}
                </p>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      {/* Service history — dates, type and mileage only. No cost, ever. */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("maintenance.title")}</CardTitle>
        </CardHeader>
        <CardContent className="p-4 pt-0">
          {maintenance.length === 0 ? (
            <p className="text-sm text-ink-2">{t("maintenance.empty")}</p>
          ) : (
            <ul className="divide-y divide-line">
              {maintenance.map((entry) => (
                <li
                  key={entry.id}
                  className="flex flex-wrap items-center justify-between gap-2 py-3"
                >
                  <span className="text-sm font-medium">
                    {entry.service_type ?? t("maintenance.untyped")}
                  </span>
                  <span className="text-xs text-ink-2">
                    {fmtDate(entry.performed_at)}
                    {entry.mileage != null
                      ? ` · ${entry.mileage.toLocaleString(locale)} ${vehicle.mileage_unit ?? "km"}`
                      : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <DriverDocumentList documents={documents} />
    </div>
  );
}

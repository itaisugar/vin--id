import { getLocale, getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import type { DriverVehicle } from "@/lib/drivers/types";
import { classifyDeadline } from "@/lib/fleet/dates";

/**
 * The driver's vehicle identity + the operational dates they need.
 *
 * Shows expiry DATES, never the insurance or inspection records behind them:
 * those tables carry `cost` and are closed to drivers in the database. The dates
 * live on the vehicle row itself, which is why they can be shown safely.
 */
export async function DriverVehicleCard({
  vehicle,
}: {
  vehicle: DriverVehicle;
}) {
  const t = await getTranslations("driver");
  const locale = await getLocale();

  const title =
    [vehicle.make, vehicle.model].filter(Boolean).join(" ").trim() ||
    vehicle.nickname ||
    t("untitled");

  const fmtDate = (value: string | null) =>
    value
      ? new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(
          new Date(value),
        )
      : "—";

  /**
   * Amber once the date is inside the shared due-soon window, red once it has
   * passed. Uses the app's single deadline definition so the driver's screen can
   * never disagree with the Fleet dashboard about what "due soon" means.
   */
  const expiryTone = (value: string | null) => {
    switch (classifyDeadline(value)) {
      case "overdue":
        return "danger" as const;
      case "due_soon":
        return "warning" as const;
      case "upcoming":
        return "success" as const;
      default:
        return "muted" as const;
    }
  };

  const facts: { label: string; value: string; tone?: "danger" | "warning" | "success" | "muted" }[] =
    [
      { label: t("fields.plate"), value: vehicle.license_plate ?? "—" },
      {
        label: t("fields.mileage"),
        value:
          vehicle.current_mileage != null
            ? `${vehicle.current_mileage.toLocaleString(locale)} ${vehicle.mileage_unit ?? "km"}`
            : "—",
      },
      {
        label: t("fields.nextService"),
        value: fmtDate(vehicle.next_service_date),
        tone: expiryTone(vehicle.next_service_date),
      },
      {
        label: t("fields.testExpiry"),
        value: fmtDate(vehicle.test_expiry_date),
        tone: expiryTone(vehicle.test_expiry_date),
      },
      {
        label: t("fields.insuranceExpiry"),
        value: fmtDate(vehicle.insurance_expiry_date),
        tone: expiryTone(vehicle.insurance_expiry_date),
      },
      { label: t("fields.vin"), value: vehicle.vin ?? "—" },
    ];

  return (
    <Card>
      <CardContent className="space-y-4 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <h2 className="text-lg font-semibold">{title}</h2>
            {vehicle.year ? (
              <p className="text-sm text-ink-2">{vehicle.year}</p>
            ) : null}
          </div>
          {vehicle.operational_status ? (
            <Badge tone="muted">{vehicle.operational_status}</Badge>
          ) : null}
        </div>

        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {facts.map((fact) => (
            <div
              key={fact.label}
              className="rounded-xl border border-line bg-surface-2 p-3"
            >
              <dt className="text-xs text-ink-3">{fact.label}</dt>
              <dd
                dir={fact.label === t("fields.vin") ? "ltr" : undefined}
                className="mt-1 truncate text-sm font-medium"
              >
                {fact.tone && fact.tone !== "muted" ? (
                  <Badge tone={fact.tone}>{fact.value}</Badge>
                ) : (
                  fact.value
                )}
              </dd>
            </div>
          ))}
        </dl>

        <p className="text-xs text-ink-3">
          {t("assignedSince", {
            date: new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(
              new Date(vehicle.assigned_at),
            ),
          })}
        </p>
      </CardContent>
    </Card>
  );
}

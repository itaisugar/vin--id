import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { OperationalStatusBadge } from "@/components/fleet/operational-status-badge";
import type { AttentionReason, VehicleAttention } from "@/lib/fleet/service";

/**
 * "Vehicles Requiring Attention" — the dashboard's primary action list.
 *
 * Ordering comes from the service (worst operational status first, then worst
 * deadline). Each row states WHY the vehicle is listed, so the fleet manager
 * can triage without opening it.
 */

function formatReason(
  reason: AttentionReason,
  t: (key: string, values?: Record<string, string | number>) => string,
  formatDate: (iso: string) => string,
): string {
  switch (reason.kind) {
    case "status":
      return t(`status.${reason.status}`);
    case "open_issues":
      return t("reasons.openIssues", { count: reason.count });
    case "service_due":
      return reason.date
        ? t(`reasons.service.${reason.state}`, { date: formatDate(reason.date) })
        : t(`reasons.serviceNoDate.${reason.state}`);
    case "service_due_km":
      return t(`reasons.serviceKm.${reason.state}`, { km: reason.dueKm });
    case "test_expiry":
      return t(`reasons.test.${reason.state}`, { date: formatDate(reason.date) });
    case "insurance_expiry":
      return t(`reasons.insurance.${reason.state}`, {
        date: formatDate(reason.date),
      });
  }
}

export async function AttentionList({
  items,
}: {
  items: VehicleAttention[];
}) {
  const t = await getTranslations("fleet");
  const locale = await getLocale();

  const formatDate = (iso: string) =>
    new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(
      new Date(`${iso}T00:00:00Z`),
    );

  return (
    <section aria-labelledby="attention-heading" className="space-y-3">
      <h2
        id="attention-heading"
        className="text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-3"
      >
        {t("attention.heading")}
      </h2>

      {items.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-line p-8 text-center">
          <p className="text-sm text-ink-2">{t("attention.empty")}</p>
        </div>
      ) : (
        <ul className="space-y-2.5">
          {items.map(({ vehicle, reasons }) => {
            const title =
              [vehicle.make, vehicle.model].filter(Boolean).join(" ").trim() ||
              t("untitledVehicle");

            return (
              <li key={vehicle.id}>
                <Link
                  href={`/vehicles/${vehicle.id}`}
                  className="flex flex-col gap-2 rounded-2xl border border-line bg-surface p-4 transition cockpit-lift hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
                >
                  <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
                    <div className="flex min-w-0 flex-wrap items-baseline gap-x-2.5 gap-y-0.5">
                      {vehicle.license_plate ? (
                        <span className="num text-sm font-bold text-ink">
                          {vehicle.license_plate}
                        </span>
                      ) : null}
                      <span className="min-w-0 break-words text-sm text-ink-2">
                        {title}
                      </span>
                    </div>
                    <OperationalStatusBadge
                      status={vehicle.operational_status}
                    />
                  </div>

                  <ul className="flex flex-wrap gap-x-2 gap-y-1">
                    {reasons.map((reason, i) => (
                      <li
                        key={i}
                        className="rounded-lg bg-surface-3 px-2 py-1 text-[11px] text-ink-2"
                      >
                        {formatReason(reason, t, formatDate)}
                      </li>
                    ))}
                  </ul>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

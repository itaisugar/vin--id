import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { DeadlineBadge } from "@/components/fleet/deadline-badge";
import { OperationalStatusBadge } from "@/components/fleet/operational-status-badge";
import type { FleetVehicleRow as Row } from "@/lib/fleet/service";
import type { DeadlineState } from "@/lib/fleet/dates";

/**
 * One vehicle in the fleet list.
 *
 * Responsive card rather than a true <table>: at 10–80 vehicles on a tablet or
 * phone a horizontally-scrolling table is unusable, and the same fields read
 * fine stacked. Desktop gets a denser multi-column grid.
 */
export async function FleetVehicleRow({ row }: { row: Row }) {
  const { vehicle: v, openIssueCount, serviceState, testState, insuranceState } = row;
  const t = await getTranslations("fleet");
  const tv = await getTranslations("vehicles");
  const locale = await getLocale();

  const title =
    [v.make, v.model].filter(Boolean).join(" ").trim() || t("untitledVehicle");

  const formatDate = (iso: string | null) =>
    iso
      ? new Intl.DateTimeFormat(locale, { dateStyle: "short" }).format(
          new Date(`${iso}T00:00:00Z`),
        )
      : "—";

  return (
    <li>
      <Link
        href={`/vehicles/${v.id}`}
        className="block rounded-2xl border border-line bg-surface p-4 transition cockpit-lift hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
      >
        {/* Identity + status */}
        <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
          <div className="min-w-0 space-y-0.5">
            <div className="flex flex-wrap items-baseline gap-x-2.5">
              {v.license_plate ? (
                <span className="num text-base font-bold text-ink">
                  {v.license_plate}
                </span>
              ) : null}
              <span className="min-w-0 break-words text-sm text-ink-2">
                {title}
                {v.year != null ? (
                  <span className="num"> · {v.year}</span>
                ) : null}
              </span>
            </div>
            {v.vehicle_type || v.assigned_driver_name ? (
              <p className="text-xs text-ink-3">
                {[v.vehicle_type, v.assigned_driver_name]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            ) : null}
          </div>

          <div className="flex shrink-0 flex-wrap items-center gap-1.5">
            {openIssueCount > 0 ? (
              <span className="rounded-full bg-warn/12 px-2.5 py-0.5 text-xs font-medium text-warn">
                {t("openIssuesCount", { count: openIssueCount })}
              </span>
            ) : null}
            <OperationalStatusBadge status={v.operational_status} />
          </div>
        </div>

        {/* Operational data */}
        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 border-t border-line pt-3 sm:grid-cols-4">
          <Field
            label={t("fields.currentKm")}
            value={
              v.current_mileage != null
                ? `${v.current_mileage.toLocaleString(locale)} ${tv(`units.${v.mileage_unit}`)}`
                : "—"
            }
          />
          <Field
            label={t("fields.nextService")}
            value={formatDate(v.next_service_date)}
            state={serviceState}
          />
          <Field
            label={t("fields.testExpiry")}
            value={formatDate(v.test_expiry_date)}
            state={testState}
          />
          <Field
            label={t("fields.insuranceExpiry")}
            value={formatDate(v.insurance_expiry_date)}
            state={insuranceState}
          />
        </dl>
      </Link>
    </li>
  );
}

function Field({
  label,
  value,
  state,
}: {
  label: string;
  value: string;
  state?: DeadlineState | null;
}) {
  return (
    <div className="min-w-0 space-y-0.5">
      <dt className="text-[10px] uppercase tracking-[0.12em] text-ink-3">
        {label}
      </dt>
      <dd className="flex flex-wrap items-center gap-1.5">
        <span className="num text-xs font-medium text-ink">{value}</span>
        {state === "overdue" || state === "due_soon" ? (
          <DeadlineBadge state={state} className="px-1.5 py-0 text-[10px]" />
        ) : null}
      </dd>
    </div>
  );
}

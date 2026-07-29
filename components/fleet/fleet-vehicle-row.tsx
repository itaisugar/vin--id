import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { DeadlineBadge } from "@/components/fleet/deadline-badge";
import { OperationalStatusBadge } from "@/components/fleet/operational-status-badge";
import { formatCost } from "@/lib/fleet/costs";
import type { FleetVehicleRow as Row } from "@/lib/fleet/service";
import type { DeadlineState } from "@/lib/fleet/dates";

/**
 * One vehicle in the fleet list.
 *
 * Responsive card rather than a true <table>: at 10–80 vehicles on a tablet or
 * phone a horizontally-scrolling table is unusable, and the same fields read
 * fine stacked. Desktop gets a denser multi-column grid.
 *
 * MOBILE DENSITY: the identity line, the attention chips and four operational
 * fields are all that appear on a phone. Cost is the fifth field and is hidden
 * below `sm` — it is the least urgent number here, and keeping it off the
 * mobile card is what stops the row becoming a spreadsheet.
 *
 * No signed URL, image fetch or per-row query happens here — everything
 * rendered arrives precomputed on `row`.
 */
export async function FleetVehicleRow({
  row,
  currency,
}: {
  row: Row;
  currency: string;
}) {
  const { vehicle: v, openIssueCount, highPriorityIssueCount, service, monthCost, actions } = row;
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

  const hasCritical = actions.some((a) => a.urgency === "critical");

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
                {v.year != null ? <span className="num"> · {v.year}</span> : null}
              </span>
            </div>
            {/* `assigned_driver_name` used to sit here beside the vehicle type
                and read exactly like an assignment. It is free text that grants
                nothing, so the official assignment is shown instead — and only
                to callers allowed to read it. */}
            {v.vehicle_type || row.hasAssignedDriver === true ? (
              <p className="text-xs text-ink-3">
                {[
                  v.vehicle_type,
                  row.hasAssignedDriver === true ? t("driverAssigned") : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            ) : null}
          </div>

          <div className="flex shrink-0 flex-wrap items-center gap-1.5">
            {/* One attention marker, driven by the same rules as the dashboard. */}
            {actions.length > 0 ? (
              <span
                className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                  hasCritical
                    ? "bg-danger/12 text-danger"
                    : "bg-warn/12 text-warn"
                }`}
              >
                {t("actionsCount", { count: actions.length })}
              </span>
            ) : null}
            {openIssueCount > 0 ? (
              <span
                className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                  highPriorityIssueCount > 0
                    ? "bg-danger/12 text-danger"
                    : "bg-warn/12 text-warn"
                }`}
              >
                {t("openIssuesCount", { count: openIssueCount })}
              </span>
            ) : null}
            {/* The EFFECTIVE status: a resolved issue clears this badge, the
                stored column alone would not. */}
            <OperationalStatusBadge status={row.effectiveStatus} />
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
            value={
              service.date
                ? formatDate(service.date)
                : service.dueKm != null
                  ? `${service.dueKm.toLocaleString(locale)} ${tv(`units.${v.mileage_unit}`)}`
                  : "—"
            }
            state={service.state}
          />
          {/* Nearest document expiry deliberately does NOT appear here. It is
              still computed (`row.documents`) and still drives the Dashboard
              expiry alerts and the vehicle-detail document view — it was simply
              one column too many on a phone. */}
          <Field
            label={t("fields.openIssues")}
            value={String(openIssueCount)}
          />
          <Field
            label={t("fields.monthCost")}
            value={monthCost != null ? formatCost(monthCost, currency, locale) : "—"}
            className="hidden sm:block"
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
  className,
}: {
  label: string;
  value: string;
  state?: DeadlineState | null;
  className?: string;
}) {
  return (
    <div className={`min-w-0 space-y-0.5 ${className ?? ""}`}>
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

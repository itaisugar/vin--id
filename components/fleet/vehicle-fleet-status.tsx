import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { DeadlineBadge } from "@/components/fleet/deadline-badge";
import { Badge } from "@/components/ui/badge";
import { formatCost } from "@/lib/fleet/costs";
import type { FleetVehicleRow } from "@/lib/fleet/service";

/**
 * The operational Fleet view of one vehicle: service, documents, issues, cost
 * and what needs doing — computed with exactly the same rules as the dashboard,
 * so a status can never differ between the two screens.
 *
 * This does NOT duplicate the Vehicle Passport, and it adds no edit flows: every
 * line links to the existing maintenance / issues / documents section that
 * already owns that record.
 *
 * DATA PROVENANCE: each status says where it comes from — a calculated value, a
 * manually entered field, or missing information. Nothing here implies a
 * document was verified when it was not.
 */
export async function VehicleFleetStatus({
  row,
  currency,
}: {
  row: FleetVehicleRow;
  currency: string;
}) {
  const t = await getTranslations("fleet.vehicleStatus");
  const ta = await getTranslations("fleet.actions");
  const locale = await getLocale();
  const { vehicle: v, service, documents, openIssueCount, highPriorityIssueCount, monthCost, actions } = row;

  const formatDate = (iso: string | null) =>
    iso
      ? new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(
          new Date(`${iso}T00:00:00Z`),
        )
      : null;

  return (
    <section
      aria-labelledby="vehicle-fleet-status-heading"
      className="space-y-3 rounded-2xl border border-line bg-surface p-4 cockpit-lift"
    >
      <h2
        id="vehicle-fleet-status-heading"
        className="text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-3"
      >
        {t("heading")}
      </h2>

      <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {/* Service — calculated from the manually entered service target. */}
        <Item
          label={t("service.label")}
          source={service.unknown ? t("source.missing") : t("source.calculated")}
          href={`/vehicles/${v.id}/maintenance`}
        >
          {service.unknown ? (
            <span className="text-sm text-ink-3">{t("service.unknown")}</span>
          ) : (
            <span className="flex flex-wrap items-center gap-2">
              <span className="num text-sm font-medium text-ink">
                {formatDate(service.date) ??
                  (service.dueKm != null
                    ? t("service.atKm", { km: service.dueKm.toLocaleString(locale) })
                    : "—")}
              </span>
              {service.state === "overdue" || service.state === "due_soon" ? (
                <DeadlineBadge state={service.state} />
              ) : null}
            </span>
          )}
        </Item>

        {/* Documents — statutory dates plus uploaded documents with an expiry. */}
        <Item
          label={t("documents.label")}
          source={
            documents.nearestExpiry ? t("source.calculated") : t("source.missing")
          }
          href={`/vehicles/${v.id}/documents`}
        >
          <span className="flex flex-wrap items-center gap-2">
            <span className="num text-sm font-medium text-ink">
              {formatDate(documents.nearestExpiry) ?? t("documents.none")}
            </span>
            {documents.worst === "overdue" || documents.worst === "due_soon" ? (
              <DeadlineBadge state={documents.worst} />
            ) : null}
            {documents.flaggedMissing ? (
              <Badge tone="warning">{t("documents.flaggedMissing")}</Badge>
            ) : null}
          </span>
          {documents.expiredCount > 0 || documents.expiringCount > 0 ? (
            <p className="mt-1 text-xs text-ink-3">
              {t("documents.counts", {
                expired: documents.expiredCount,
                expiring: documents.expiringCount,
              })}
            </p>
          ) : null}
        </Item>

        {/* Issues — real records. */}
        <Item
          label={t("issues.label")}
          source={t("source.records")}
          href={`/vehicles/${v.id}/issues`}
        >
          <span className="flex flex-wrap items-center gap-2">
            <span className="num text-sm font-medium text-ink">
              {openIssueCount}
            </span>
            {highPriorityIssueCount > 0 ? (
              <Badge tone="danger">
                {t("issues.highPriority", { count: highPriorityIssueCount })}
              </Badge>
            ) : null}
          </span>
        </Item>

        {/* Cost — persisted maintenance spend for the current month. */}
        <Item
          label={t("cost.label")}
          source={t("source.records")}
          href={`/vehicles/${v.id}/maintenance`}
        >
          <span className="num text-sm font-medium text-ink">
            {monthCost != null ? formatCost(monthCost, currency, locale) : t("cost.none")}
          </span>
        </Item>
      </dl>

      {actions.length > 0 ? (
        <div className="border-t border-line pt-3">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-3">
            {t("upcoming")}
          </p>
          <ul className="space-y-1.5">
            {actions.map((action) => (
              <li key={action.id}>
                <Link
                  href={action.href}
                  className="flex items-center justify-between gap-3 rounded-xl bg-surface-2 px-3 py-2 text-xs transition hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                  <span className="min-w-0 text-ink-2">
                    {ta(`reasons.${action.type}`, {
                      count: action.count ?? 0,
                      detail: action.detail ?? "",
                      date: formatDate(action.date) ?? "",
                    })}
                  </span>
                  <span className="shrink-0 font-medium text-accent">
                    {ta(`urgency.${action.urgency}`)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

function Item({
  label,
  source,
  href,
  children,
}: {
  label: string;
  source: string;
  href: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-w-0">
      <dt className="flex items-baseline justify-between gap-2">
        <span className="text-[10px] uppercase tracking-[0.12em] text-ink-3">
          {label}
        </span>
        <Link href={href} className="text-[11px] text-accent hover:underline">
          {source}
        </Link>
      </dt>
      <dd className="mt-0.5">{children}</dd>
    </div>
  );
}

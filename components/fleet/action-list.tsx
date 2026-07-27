import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/badge";
import type { FleetAction, UrgencyLevel } from "@/lib/fleet/alerts";

/**
 * "What requires action today" — one ordered list, not a wall of numbers.
 *
 * Ordering is the documented urgency rank from `lib/fleet/alerts.ts`:
 * overdue/expired, then urgent issues, then due-soon/expiring, then missing
 * information, then cost anomalies. Every row names its vehicle, gives the
 * reason, and links to the record that resolves it.
 *
 * Each vehicle contributes at most one action per problem area, so a vehicle
 * with five expired documents appears once — it does not bury the rest of the
 * fleet.
 */

const URGENCY_TONE: Record<UrgencyLevel, "danger" | "warning" | "muted"> = {
  critical: "danger",
  high: "danger",
  soon: "warning",
  info: "muted",
};

export async function ActionList({ items }: { items: FleetAction[] }) {
  const t = await getTranslations("fleet.actions");
  const locale = await getLocale();

  if (items.length === 0) {
    return (
      <section aria-labelledby="fleet-actions-heading" className="space-y-3">
        <h2
          id="fleet-actions-heading"
          className="text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-3"
        >
          {t("heading")}
        </h2>
        <div className="rounded-2xl border border-ok/30 bg-ok/8 p-6 text-center">
          <p className="text-sm font-semibold text-ok">{t("allClear")}</p>
          <p className="mt-1 text-sm text-ink-2">{t("allClearBody")}</p>
        </div>
      </section>
    );
  }

  const formatDate = (iso: string | null) =>
    iso
      ? new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(
          new Date(`${iso}T00:00:00Z`),
        )
      : null;

  return (
    <section aria-labelledby="fleet-actions-heading" className="space-y-3">
      <h2
        id="fleet-actions-heading"
        className="text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-3"
      >
        {t("heading")}
      </h2>

      <ul className="space-y-2">
        {items.map((action) => {
          const date = formatDate(action.date);
          // Each action type owns its reason string, so the sentence always
          // matches the rule that produced it.
          const reason = t(`reasons.${action.type}`, {
            count: action.count ?? 0,
            detail: action.detail ?? "",
            date: date ?? "",
          });

          return (
            <li key={action.id}>
              <Link
                href={action.href}
                className="flex items-start justify-between gap-3 rounded-2xl border border-line bg-surface p-3.5 transition cockpit-lift hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
              >
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    {action.licensePlate ? (
                      <span className="num text-sm font-bold text-ink">
                        {action.licensePlate}
                      </span>
                    ) : null}
                    <span className="min-w-0 break-words text-sm text-ink-2">
                      {action.vehicleLabel || t("untitledVehicle")}
                    </span>
                  </div>
                  <p className="text-xs text-ink-2">{reason}</p>
                  {date ? (
                    <p className="num text-[11px] text-ink-3">{date}</p>
                  ) : null}
                </div>

                <Badge tone={URGENCY_TONE[action.urgency]} className="shrink-0">
                  {t(`urgency.${action.urgency}`)}
                </Badge>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

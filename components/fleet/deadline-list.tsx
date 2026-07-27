import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { DeadlineBadge } from "@/components/fleet/deadline-badge";
import type { FleetDeadline } from "@/lib/fleet/service";

/**
 * "Upcoming Maintenance & Documents" — every dated obligation across the fleet
 * that is overdue or falls inside the due-soon window, closest first.
 *
 * Sources: vehicle next-service date, test expiry, insurance expiry, document
 * expiry dates, and existing reminder due dates. All real data — nothing is
 * synthesised to fill the list.
 */
export async function DeadlineList({ items }: { items: FleetDeadline[] }) {
  const t = await getTranslations("fleet");
  const locale = await getLocale();

  const formatDate = (iso: string) =>
    new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(
      new Date(`${iso}T00:00:00Z`),
    );

  return (
    <section aria-labelledby="deadlines-heading" className="space-y-3">
      <h2
        id="deadlines-heading"
        className="text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-3"
      >
        {t("deadlines.heading")}
      </h2>

      {items.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-line p-8 text-center">
          <p className="text-sm text-ink-2">{t("deadlines.empty")}</p>
        </div>
      ) : (
        <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface">
          {items.map((d, i) => (
            <li key={`${d.vehicleId}-${d.kind}-${i}`}>
              <Link
                href={`/vehicles/${d.vehicleId}`}
                className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 p-3.5 transition hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
              >
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span className="text-sm font-medium text-ink">
                    {t(`deadlines.kind.${d.kind}`)}
                    {d.label ? (
                      <span className="font-normal text-ink-2"> · {d.label}</span>
                    ) : null}
                  </span>
                  <span className="flex flex-wrap items-baseline gap-x-2 text-xs text-ink-2">
                    {d.licensePlate ? (
                      <span className="num font-semibold">{d.licensePlate}</span>
                    ) : null}
                    <span className="min-w-0 break-words">{d.vehicleLabel}</span>
                  </span>
                </div>

                <div className="flex shrink-0 items-center gap-2">
                  {d.date ? (
                    <span className="num text-xs text-ink-2">
                      {formatDate(d.date)}
                    </span>
                  ) : null}
                  <DeadlineBadge state={d.state} />
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

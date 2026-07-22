import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { FLEET_FILTERS, type FleetFilter, type FleetSort } from "@/lib/fleet/types";

/**
 * Filter chips for the fleet list.
 *
 * Implemented as plain links over `?filter=` so filtering works without client
 * JavaScript and every filtered view is a shareable URL. The active sort is
 * carried through so switching filter never silently resets sorting.
 */
export async function FleetFilterBar({
  active,
  sort,
  counts,
}: {
  active: FleetFilter;
  sort: FleetSort;
  counts: Record<FleetFilter, number>;
}) {
  const t = await getTranslations("fleet.filters");

  return (
    <nav aria-label={t("label")} className="-mx-1 overflow-x-auto px-1 pb-1">
      <ul className="flex w-max gap-2">
        {FLEET_FILTERS.map((filter) => {
          const isActive = filter === active;
          const count = counts[filter];

          return (
            <li key={filter}>
              <Link
                href={`/vehicles?filter=${filter}&sort=${sort}`}
                aria-current={isActive ? "page" : undefined}
                className={`inline-flex h-9 items-center gap-1.5 whitespace-nowrap rounded-xl border px-3 text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg ${
                  isActive
                    ? "border-accent bg-accent text-on-accent"
                    : "border-line bg-surface-2 text-ink-2 hover:bg-surface hover:text-ink"
                }`}
              >
                {t(filter)}
                <span
                  className={`num text-[11px] ${isActive ? "text-on-accent/80" : "text-ink-3"}`}
                >
                  {count}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

import Link from "next/link";
import { getTranslations } from "next-intl/server";
import {
  PRIMARY_FLEET_FILTERS,
  type FleetFilter,
  type FleetSort,
} from "@/lib/fleet/types";

/**
 * Filter chips for the fleet list.
 *
 * Implemented as plain links over `?filter=` so filtering works without client
 * JavaScript and every filtered view is a shareable URL. The active sort and
 * search term are carried through, so changing a filter never silently discards
 * the other two.
 *
 * Only the practical filters are offered as chips. The operational statuses
 * remain valid `?filter=` values so the dashboard tiles can deep-link into them,
 * but they are not all shown here — a chip row with fourteen options is a query
 * builder, which this deliberately is not.
 */
export async function FleetFilterBar({
  active,
  sort,
  search,
  counts,
}: {
  active: FleetFilter;
  sort: FleetSort;
  search: string;
  counts: Record<FleetFilter, number>;
}) {
  const t = await getTranslations("fleet.filters");

  // Show the active filter even when it is a status deep-linked from a tile.
  const chips: FleetFilter[] = PRIMARY_FLEET_FILTERS.includes(active)
    ? [...PRIMARY_FLEET_FILTERS]
    : [...PRIMARY_FLEET_FILTERS, active];

  const href = (filter: FleetFilter) => {
    const params = new URLSearchParams({ filter, sort });
    if (search) params.set("q", search);
    return `/vehicles?${params.toString()}`;
  };

  return (
    <nav aria-label={t("label")} className="-mx-1 overflow-x-auto px-1 pb-1">
      <ul className="flex w-max gap-2">
        {chips.map((filter) => {
          const isActive = filter === active;

          return (
            <li key={filter}>
              <Link
                href={href(filter)}
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
                  {counts[filter]}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

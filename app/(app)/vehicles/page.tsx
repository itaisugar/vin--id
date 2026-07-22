import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { FleetFilterBar } from "@/components/fleet/fleet-filter-bar";
import { FleetSortSelect } from "@/components/fleet/fleet-sort-select";
import { FleetVehicleRow } from "@/components/fleet/fleet-vehicle-row";
import { OrganizationMissing } from "@/components/fleet/organization-missing";
import { CarIcon } from "@/components/icons";
import { OrganizationMissingError } from "@/lib/auth/errors";
import { listFleetVehicles, type FleetVehiclesResult } from "@/lib/fleet/service";
import {
  DEFAULT_FLEET_SORT,
  isFleetFilter,
  isFleetSort,
} from "@/lib/fleet/types";

/**
 * Fleet vehicles list — organization-scoped, filterable, sortable.
 *
 * Filter and sort live in the URL (`?filter=&sort=`), so the page stays a
 * server component, each view is linkable, and an unrecognised value in the
 * query string falls back to a safe default instead of erroring.
 */
export default async function VehiclesPage({
  searchParams,
}: PageProps<"/vehicles">) {
  const params = await searchParams;
  const t = await getTranslations("fleet");
  const tv = await getTranslations("vehicles");

  const filterParam = Array.isArray(params.filter)
    ? params.filter[0]
    : params.filter;
  const sortParam = Array.isArray(params.sort) ? params.sort[0] : params.sort;

  const filter = isFleetFilter(filterParam) ? filterParam : "all";
  const sort = isFleetSort(sortParam) ? sortParam : DEFAULT_FLEET_SORT;

  let result: FleetVehiclesResult;
  try {
    result = await listFleetVehicles(filter, sort);
  } catch (error) {
    if (error instanceof OrganizationMissingError) return <OrganizationMissing />;
    throw error;
  }

  const { rows, counts } = result;
  const fleetIsEmpty = counts.all === 0;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-extrabold tracking-tight">
          {t("vehicles.title")}
        </h1>
        <Link
          href="/vehicles/new"
          className="inline-flex h-10 shrink-0 items-center justify-center rounded-xl bg-accent px-4 text-sm font-semibold text-on-accent transition-transform active:scale-[.98]"
        >
          {tv("addVehicle")}
        </Link>
      </div>

      {fleetIsEmpty ? (
        <EmptyFleetState />
      ) : (
        <>
          <div className="space-y-3">
            <FleetFilterBar active={filter} sort={sort} counts={counts} />
            <div className="flex justify-end">
              <FleetSortSelect value={sort} filter={filter} />
            </div>
          </div>

          {rows.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-line p-10 text-center">
              <p className="text-sm text-ink-2">
                {t("vehicles.noneForFilter", { filter: t(`filters.${filter}`) })}
              </p>
              <Link
                href="/vehicles?filter=all"
                className="mt-3 inline-block text-sm font-medium text-accent hover:underline"
              >
                {t("vehicles.clearFilter")}
              </Link>
            </div>
          ) : (
            <ul className="space-y-2.5">
              {rows.map((row) => (
                <FleetVehicleRow key={row.vehicle.id} row={row} />
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

async function EmptyFleetState() {
  const t = await getTranslations("fleet.emptyFleet");
  const tv = await getTranslations("vehicles");

  return (
    <div className="flex flex-col items-center justify-center gap-4 rounded-2xl border border-dashed border-line p-12 text-center">
      <CarIcon className="h-10 w-10 text-ink-2" />
      <div className="space-y-1">
        <p className="font-medium">{t("heading")}</p>
        <p className="max-w-sm text-sm text-ink-2">{t("explainer")}</p>
      </div>
      <Link
        href="/vehicles/new"
        className="inline-flex h-10 items-center justify-center rounded-xl bg-accent px-4 text-sm font-semibold text-on-accent transition-transform active:scale-[.98]"
      >
        {tv("addVehicle")}
      </Link>
    </div>
  );
}

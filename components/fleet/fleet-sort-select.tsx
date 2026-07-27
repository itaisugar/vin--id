"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useId, useTransition } from "react";
import { Select } from "@/components/ui/select";
import { FLEET_SORTS, type FleetFilter, type FleetSort } from "@/lib/fleet/types";

/**
 * Sort control for the fleet list.
 *
 * Navigates on change (the list is server-rendered from the URL). Deliberately
 * uses no `useEffect` — the app's lint config forbids setState inside effects,
 * and there is no state to sync here anyway: the URL is the single source of
 * truth and `value` is driven by the prop.
 */
export function FleetSortSelect({
  value,
  filter,
  search,
}: {
  value: FleetSort;
  filter: FleetFilter;
  /** Carried through so changing sort does not discard the search term. */
  search: string;
}) {
  const t = useTranslations("fleet.sort");
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const id = useId();

  return (
    <div className="flex items-center gap-2">
      <label htmlFor={id} className="shrink-0 text-xs text-ink-3">
        {t("label")}
      </label>
      <Select
        id={id}
        value={value}
        disabled={isPending}
        onChange={(e) => {
          const params = new URLSearchParams({ filter, sort: e.target.value });
          if (search) params.set("q", search);
          startTransition(() => {
            router.push(`/vehicles?${params.toString()}`);
          });
        }}
        className="h-9 w-auto min-w-[10rem] text-xs"
      >
        {FLEET_SORTS.map((sort) => (
          <option key={sort} value={sort}>
            {t(sort)}
          </option>
        ))}
      </Select>
    </div>
  );
}

"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useId, useState, useTransition } from "react";
import { Input } from "@/components/ui/input";
import type { FleetFilter, FleetSort } from "@/lib/fleet/types";

/**
 * Search over the fleet list.
 *
 * Submits to the URL (`?q=`) rather than filtering client-side, so the results
 * are produced by the same org-scoped server query as every other view and a
 * search is a shareable link. Matching happens AFTER organization scoping, so a
 * search term can never surface another organization's vehicle.
 *
 * The active filter and sort ride along, so searching does not reset them.
 */
export function FleetSearch({
  value,
  filter,
  sort,
}: {
  value: string;
  filter: FleetFilter;
  sort: FleetSort;
}) {
  const t = useTranslations("fleet.search");
  const router = useRouter();
  const id = useId();
  const [term, setTerm] = useState(value);
  const [isPending, startTransition] = useTransition();

  const navigate = (next: string) => {
    const params = new URLSearchParams({ filter, sort });
    const trimmed = next.trim();
    if (trimmed) params.set("q", trimmed);
    startTransition(() => router.push(`/vehicles?${params.toString()}`));
  };

  return (
    <form
      role="search"
      className="flex items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        navigate(term);
      }}
    >
      <label htmlFor={id} className="sr-only">
        {t("label")}
      </label>
      <Input
        id={id}
        type="search"
        inputMode="search"
        autoComplete="off"
        placeholder={t("placeholder")}
        value={term}
        disabled={isPending}
        onChange={(e) => setTerm(e.target.value)}
        className="h-9 text-sm"
      />
      {value ? (
        <button
          type="button"
          onClick={() => {
            setTerm("");
            navigate("");
          }}
          className="shrink-0 rounded-lg px-2 py-1 text-xs font-medium text-accent hover:underline"
        >
          {t("clear")}
        </button>
      ) : null}
    </form>
  );
}

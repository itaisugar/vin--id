import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { AlertIcon } from "@/components/icons";
import { arcState } from "@/components/fleet/vehicle-arc-card";
import type { FleetVehicleRow } from "@/lib/fleet/service";

/**
 * One compact attention surface — never a wall of alert cards.
 *
 * When any vehicle needs attention it renders a single full-width banner: the
 * count, a concise list of affected plates (with "+N" overflow) and one Review
 * link to the existing needs-attention list. When nothing is wrong it collapses
 * to a small, quiet all-clear line — no large success panel, no zero values.
 *
 * "Needs attention" is exactly the existing rule: a vehicle with at least one
 * action (see `arcState` / `FleetVehicleRow.actions`).
 */

const MAX_PLATES = 3;

export async function AttentionBanner({ rows }: { rows: FleetVehicleRow[] }) {
  const t = await getTranslations("dashboard.attention");

  const affected = rows.filter((r) => r.actions.length > 0);

  // Quiet all-clear — deliberately small; does not match an active warning's height.
  if (affected.length === 0) {
    return (
      <p className="flex items-center gap-2 text-sm text-ink-3">
        <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-ok" />
        {t("allClear")}
      </p>
    );
  }

  const hasDanger = affected.some((r) => arcState(r) === "danger");
  const tone = hasDanger
    ? { border: "border-danger/40", chip: "bg-danger/12 text-danger", title: "text-danger", cta: "text-danger" }
    : { border: "border-warn/40", chip: "bg-warn/12 text-warn", title: "text-warn", cta: "text-warn" };

  const labelOf = (r: FleetVehicleRow) =>
    r.vehicle.license_plate ||
    [r.vehicle.make, r.vehicle.model].filter(Boolean).join(" ").trim();

  const shown = affected.slice(0, MAX_PLATES).map(labelOf).filter(Boolean);
  const overflow = affected.length - shown.length;

  return (
    <Link
      href="/vehicles?filter=needs_attention"
      className={`flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-2xl border ${tone.border} bg-surface p-4 transition hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg`}
    >
      <div className="flex min-w-0 items-center gap-3">
        <span
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${tone.chip}`}
        >
          <AlertIcon className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <p className={`text-sm font-bold ${tone.title}`}>{t("title")}</p>
          <p className="num truncate text-xs text-ink-2">
            {shown.join(" · ")}
            {overflow > 0 ? (
              <span className="text-ink-3"> {t("more", { count: overflow })}</span>
            ) : null}
          </p>
        </div>
      </div>

      <span
        className={`inline-flex shrink-0 items-center gap-1 text-sm font-semibold ${tone.cta}`}
      >
        {t("review")}
        <span aria-hidden className="rtl:-scale-x-100">
          →
        </span>
      </span>
    </Link>
  );
}

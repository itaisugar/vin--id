import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import type { FleetVehicleRow } from "@/lib/fleet/service";
import type { UrgencyLevel } from "@/lib/fleet/alerts";

/**
 * One large, calm vehicle card — the main interaction surface of the dashboard.
 *
 * The left arc is a STATUS MOTIF, not a gauge: fixed 270° geometry on every
 * card, and only its colour carries meaning. It never encodes a percentage,
 * score, progress or remaining time. Status is always also stated in text
 * (plate + one status line), so meaning never rests on colour alone.
 *
 * State is derived from the vehicle's real actions — the same alert rules the
 * fleet list uses (a vehicle "needs attention" exactly when it has an action).
 * There is no second status calculation here.
 */

type ArcState = "danger" | "warn" | "ok";

const URGENCY_RANK: Record<UrgencyLevel, number> = {
  critical: 1,
  high: 2,
  soon: 3,
  info: 4,
};

/** The single most-urgent action on a row, or null when the vehicle is ready. */
function worstAction(row: FleetVehicleRow) {
  if (row.actions.length === 0) return null;
  return [...row.actions].sort(
    (a, b) => URGENCY_RANK[a.urgency] - URGENCY_RANK[b.urgency],
  )[0];
}

/** danger for a critical/urgent state, warn for any other action, ok when ready. */
export function arcState(row: FleetVehicleRow): ArcState {
  const a = worstAction(row);
  if (!a) return "ok";
  return a.urgency === "critical" || a.urgency === "high" ? "danger" : "warn";
}

/**
 * Ordering key for urgency-first vehicle lists (lower = more urgent; Infinity
 * when the vehicle is ready). Uses the existing action urgency rank — no second
 * status calculation.
 */
export function rowUrgencyKey(row: FleetVehicleRow): number {
  const a = worstAction(row);
  return a ? URGENCY_RANK[a.urgency] : Number.POSITIVE_INFINITY;
}

const ARC_STROKE: Record<ArcState, string> = {
  danger: "stroke-danger",
  warn: "stroke-warn",
  ok: "stroke-ok",
};
const DOT: Record<ArcState, string> = {
  danger: "bg-danger",
  warn: "bg-warn",
  ok: "bg-ok",
};

/**
 * Fixed 270° status arc. Identical geometry for every card; colour is the only
 * variable. A faint full-circle track sits behind the coloured arc.
 */
function StatusArc({ state }: { state: ArcState }) {
  return (
    <svg
      viewBox="0 0 100 100"
      className="h-16 w-16 shrink-0 sm:h-20 sm:w-20"
      aria-hidden
    >
      <circle
        cx="50"
        cy="50"
        r="42"
        fill="none"
        strokeWidth="6.5"
        className="stroke-track"
      />
      <path
        d="M 20.3 79.7 A 42 42 0 1 1 79.7 79.7"
        fill="none"
        strokeWidth="6.5"
        strokeLinecap="round"
        className={ARC_STROKE[state]}
      />
    </svg>
  );
}

export async function VehicleArcCard({ row }: { row: FleetVehicleRow }) {
  const v = row.vehicle;
  const t = await getTranslations("fleet");
  const td = await getTranslations("dashboard.vehicles");
  const locale = await getLocale();

  const title =
    [v.make, v.model].filter(Boolean).join(" ").trim() || t("untitledVehicle");
  const state = arcState(row);
  const top = worstAction(row);

  const formatDate = (iso: string | null) =>
    iso
      ? new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(
          new Date(`${iso}T00:00:00Z`),
        )
      : "";

  // Reuse the existing, validated reason wording; ready vehicles say "Ready".
  const statusLine = top
    ? t(`actions.reasons.${top.type}`, {
        count: top.count ?? 0,
        detail: top.detail ?? "",
        date: formatDate(top.date),
      })
    : td("ready");

  const statusTone =
    state === "danger"
      ? "text-danger"
      : state === "warn"
        ? "text-warn"
        : "text-ink-3";

  return (
    <Link
      href={`/vehicles/${v.id}`}
      className="flex h-full items-center gap-4 rounded-2xl border border-line bg-surface p-5 transition cockpit-lift hover:bg-surface-2 active:scale-[.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg sm:gap-5 sm:p-6"
    >
      <StatusArc state={state} />

      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex items-center gap-2">
          {v.license_plate ? (
            <span className="num truncate text-xl font-bold text-ink sm:text-2xl">
              {v.license_plate}
            </span>
          ) : (
            <span className="truncate text-lg font-bold text-ink">{title}</span>
          )}
          <span
            aria-hidden
            className={`h-2 w-2 shrink-0 rounded-full ${DOT[state]}`}
          />
        </div>

        {v.license_plate ? (
          <p className="truncate text-sm text-ink-2">
            {title}
            {v.year != null ? <span className="num"> · {v.year}</span> : null}
          </p>
        ) : v.year != null ? (
          <p className="num text-sm text-ink-2">{v.year}</p>
        ) : null}

        <p className={`truncate text-sm font-medium ${statusTone}`}>
          {statusLine}
        </p>
      </div>
    </Link>
  );
}

import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { CarIcon } from "@/components/icons";
import type { FleetVehicleRow } from "@/lib/fleet/service";
import type { UrgencyLevel } from "@/lib/fleet/alerts";

/**
 * One large, calm vehicle card — the main interaction surface of the dashboard.
 *
 * The left circle is a real VEHICLE HEALTH RING: its fill is a deterministic
 * 0–100 health score (100 = healthy → full circle) and its colour steps green →
 * orange → red as attention rises. The make name sits in the centre. Meaning is
 * carried by fill, colour AND the text status line below, never colour alone.
 *
 * The score is derived only from the vehicle's real actions — the same alert
 * rules the fleet list uses. There is no second status calculation and no new
 * backend data.
 */

type RingState = "danger" | "warn" | "ok";

const URGENCY_RANK: Record<UrgencyLevel, number> = {
  critical: 1,
  high: 2,
  soon: 3,
  info: 4,
};

/**
 * How many points each active problem removes from a starting 100.
 *
 * Weights follow the existing urgency levels; a problem area that affects
 * several records (e.g. three expiring documents — one action carrying a count)
 * removes a little more, capped so one noisy vehicle cannot dominate.
 */
const PENALTY: Record<UrgencyLevel, number> = {
  critical: 72,
  high: 58,
  soon: 22,
  info: 16,
};

/**
 * Deterministic dashboard health score in [0, 100].
 * 100 = no active attention. Each action subtracts by urgency (+ a small,
 * capped amount when that action covers more than one record).
 */
export function healthScore(row: FleetVehicleRow): number {
  let score = 100;
  for (const a of row.actions) {
    score -= PENALTY[a.urgency];
    if (a.count && a.count > 1) score -= Math.min((a.count - 1) * 5, 15);
  }
  return Math.max(0, Math.min(100, score));
}

/**
 * Colour band for the ring, derived from the health score:
 *   score >= 85 → ok (green)      — reachable only with no active attention
 *   45 <= score < 85 → warn (orange)
 *   score < 45 → danger (red)     — urgent, or several attention items at once
 *
 * Kept as `arcState` so the attention banner (which reuses it for its tone)
 * stays perfectly consistent with the cards.
 */
export function arcState(row: FleetVehicleRow): RingState {
  const score = healthScore(row);
  if (score >= 85) return "ok";
  if (score >= 45) return "warn";
  return "danger";
}

/** The single most-urgent action on a row, or null when the vehicle is ready. */
function worstAction(row: FleetVehicleRow) {
  if (row.actions.length === 0) return null;
  return [...row.actions].sort(
    (a, b) => URGENCY_RANK[a.urgency] - URGENCY_RANK[b.urgency],
  )[0];
}

/**
 * Ordering key for urgency-first vehicle lists (lower = more urgent; Infinity
 * when the vehicle is ready). Uses the existing action urgency rank.
 */
export function rowUrgencyKey(row: FleetVehicleRow): number {
  const a = worstAction(row);
  return a ? URGENCY_RANK[a.urgency] : Number.POSITIVE_INFINITY;
}

const RING_STROKE: Record<RingState, string> = {
  danger: "stroke-danger",
  warn: "stroke-warn",
  ok: "stroke-ok",
};
const DOT: Record<RingState, string> = {
  danger: "bg-danger",
  warn: "bg-warn",
  ok: "bg-ok",
};

const R = 42;
const CIRC = 2 * Math.PI * R; // ~263.89

/**
 * Full-circle health ring. The coloured stroke fills a fraction of the circle
 * equal to score/100 (100 → full circle); the remainder shows the faint track.
 * The make name is centred inside; a long make wraps to two small lines and
 * truncates rather than overflowing.
 */
function HealthRing({
  score,
  state,
  make,
}: {
  score: number;
  state: RingState;
  make: string | null;
}) {
  const offset = CIRC * (1 - score / 100);
  return (
    <div className="relative h-16 w-16 shrink-0 sm:h-20 sm:w-20">
      <svg viewBox="0 0 100 100" className="h-full w-full" aria-hidden>
        <circle
          cx="50"
          cy="50"
          r={R}
          fill="none"
          strokeWidth="7"
          className="stroke-track"
        />
        <circle
          cx="50"
          cy="50"
          r={R}
          fill="none"
          strokeWidth="7"
          strokeLinecap="round"
          strokeDasharray={CIRC}
          strokeDashoffset={offset}
          transform="rotate(-90 50 50)"
          className={RING_STROKE[state]}
        />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center px-2 text-center">
        {make ? (
          <span className="line-clamp-2 break-words text-[10px] font-bold uppercase leading-none tracking-tight text-ink sm:text-[11px]">
            {make}
          </span>
        ) : (
          <CarIcon className="h-5 w-5 text-ink-2" />
        )}
      </span>
    </div>
  );
}

export async function VehicleArcCard({ row }: { row: FleetVehicleRow }) {
  const v = row.vehicle;
  const t = await getTranslations("fleet");
  const td = await getTranslations("dashboard.vehicles");
  const locale = await getLocale();

  const state = arcState(row);
  const score = healthScore(row);
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

  // The make now lives inside the ring, so the body reads model · year.
  const subtitle = [v.model, v.year != null ? String(v.year) : null]
    .filter(Boolean)
    .join(" · ");

  return (
    <Link
      href={`/vehicles/${v.id}`}
      className="flex h-full items-center gap-4 rounded-2xl border border-line bg-surface p-5 transition cockpit-lift hover:bg-surface-2 active:scale-[.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg sm:gap-5 sm:p-6"
    >
      <HealthRing score={score} state={state} make={v.make} />

      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex items-center gap-2">
          {v.license_plate ? (
            <span className="num truncate text-xl font-bold text-ink sm:text-2xl">
              {v.license_plate}
            </span>
          ) : (
            <span className="truncate text-lg font-bold text-ink">
              {[v.make, v.model].filter(Boolean).join(" ").trim() ||
                t("untitledVehicle")}
            </span>
          )}
          <span
            aria-hidden
            className={`h-2 w-2 shrink-0 rounded-full ${DOT[state]}`}
          />
        </div>

        {subtitle ? (
          <p className="truncate text-sm text-ink-2">
            {v.model ? v.model : null}
            {v.model && v.year != null ? (
              <span className="num"> · {v.year}</span>
            ) : v.year != null ? (
              <span className="num">{v.year}</span>
            ) : null}
          </p>
        ) : null}

        <p className={`truncate text-sm font-medium ${statusTone}`}>
          {statusLine}
        </p>
      </div>
    </Link>
  );
}

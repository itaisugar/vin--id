import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { formatCost } from "@/lib/fleet/costs";
import type { FleetSummary } from "@/lib/fleet/service";

/**
 * The dashboard's top row: "what is the state of the fleet right now?".
 *
 * Every tile is a REAL count from organization-scoped rows. There are no
 * placeholder metrics and no fabricated compliance figures — a metric with no
 * data behind it shows 0, which is the honest value.
 *
 * LABEL DISCIPLINE: a tile that counts documents says "documents"; a tile that
 * counts vehicles says "vehicles". The previous version had one tile reading
 * "Documents to handle" while counting vehicles, which quietly overstated how
 * much paperwork was outstanding.
 */

interface Tile {
  key: string;
  value: string | number;
  href?: string;
  tone?: "default" | "warn" | "danger";
}

function StatTile({
  label,
  value,
  href,
  tone = "default",
}: {
  label: string;
  value: string | number;
  href?: string;
  tone?: "default" | "warn" | "danger";
}) {
  const isPositive = typeof value === "number" ? value > 0 : true;
  const valueTone =
    tone === "danger" && isPositive
      ? "text-danger"
      : tone === "warn" && isPositive
        ? "text-warn"
        : "text-ink";

  const inner = (
    <>
      <span className={`num text-2xl font-bold ${valueTone}`}>{value}</span>
      <span className="text-[11px] font-medium leading-tight text-ink-3">
        {label}
      </span>
    </>
  );

  const base =
    "flex flex-col gap-1 rounded-2xl border border-line bg-surface p-3 cockpit-lift";

  if (href) {
    return (
      <Link
        href={href}
        className={`${base} transition hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg`}
      >
        {inner}
      </Link>
    );
  }

  return <div className={base}>{inner}</div>;
}

export async function FleetSummaryCards({
  summary,
}: {
  summary: FleetSummary;
}) {
  const t = await getTranslations("fleet.summary");
  const locale = await getLocale();

  const tiles: Tile[] = [
    { key: "totalVehicles", value: summary.totalVehicles, href: "/vehicles" },
    {
      key: "operational",
      value: summary.operational,
      href: "/vehicles?filter=active",
    },
    {
      key: "requiresAttention",
      value: summary.requiresAttention,
      href: "/vehicles?filter=needs_attention",
      tone: "warn",
    },
    {
      key: "servicesOverdue",
      value: summary.servicesOverdue,
      href: "/vehicles?filter=service_overdue",
      tone: "danger",
    },
    {
      key: "servicesDueSoon",
      value: summary.servicesDueSoon,
      href: "/vehicles?filter=service_due_soon",
      tone: "warn",
    },
    // Document-expiry summary tiles were removed from the dashboard: they were
    // noise on the "what needs action today?" home screen. Document expiry still
    // surfaces where it is actionable — the action list, the deadline list, the
    // /vehicles?filter=document_expiring view, Documents and Service & Compliance.
    // The underlying summary.documentsExpired* counts are still computed and
    // validated; only their presentation here is gone.
    {
      key: "openIssues",
      value: summary.openIssues,
      href: "/vehicles?filter=open_issues",
      tone: summary.highPriorityIssues > 0 ? "danger" : "warn",
    },
    {
      key: "monthCost",
      // Real persisted maintenance spend for the current month. Never converted
      // between currencies — see lib/fleet/costs.ts.
      value: formatCost(summary.monthCost, summary.costCurrency, locale),
    },
  ];

  return (
    <section aria-labelledby="fleet-summary-heading" className="space-y-3">
      <h2
        id="fleet-summary-heading"
        className="text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-3"
      >
        {t("heading")}
      </h2>
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5">
        {tiles.map((tile) => (
          <StatTile
            key={tile.key}
            label={t(tile.key)}
            value={tile.value}
            href={tile.href}
            tone={tile.tone}
          />
        ))}
      </div>

      {summary.costMixedCurrency ? (
        <p className="text-xs text-ink-3">{t("mixedCurrencyNote")}</p>
      ) : null}
    </section>
  );
}

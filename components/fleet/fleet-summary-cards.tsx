import Link from "next/link";
import { getTranslations } from "next-intl/server";
import type { FleetSummary } from "@/lib/fleet/service";

/**
 * The dashboard's top row: "what is the state of the fleet right now?".
 *
 * Every tile shows a REAL count derived from organization-scoped data. There
 * are no placeholder metrics — a metric with no data behind it shows 0, which
 * is the honest value, and the tiles that would be meaningless at zero are
 * simply not linked anywhere.
 */

interface Tile {
  key: string;
  value: number;
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
  value: number;
  href?: string;
  tone?: "default" | "warn" | "danger";
}) {
  const valueTone =
    tone === "danger" && value > 0
      ? "text-danger"
      : tone === "warn" && value > 0
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

  const tiles: Tile[] = [
    { key: "totalVehicles", value: summary.totalVehicles, href: "/vehicles" },
    {
      key: "active",
      value: summary.active,
      href: "/vehicles?filter=active",
    },
    {
      key: "needsService",
      value: summary.needsService,
      href: "/vehicles?filter=needs_service",
      tone: "warn",
    },
    {
      key: "issueOpen",
      value: summary.issueOpen,
      href: "/vehicles?filter=issue_open",
      tone: "warn",
    },
    {
      key: "outOfService",
      value: summary.outOfService,
      href: "/vehicles?filter=out_of_service",
      tone: "danger",
    },
    {
      key: "inGarage",
      value: summary.inGarage,
      href: "/vehicles?filter=in_garage",
    },
    {
      key: "documentsAttention",
      value: summary.documentsAttention,
      tone: "warn",
    },
    { key: "upcomingMaintenance", value: summary.upcomingMaintenance, tone: "warn" },
  ];

  return (
    <section aria-labelledby="fleet-summary-heading" className="space-y-3">
      <h2
        id="fleet-summary-heading"
        className="text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-3"
      >
        {t("heading")}
      </h2>
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4">
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
    </section>
  );
}

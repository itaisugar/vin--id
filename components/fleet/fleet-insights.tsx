import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { formatCost } from "@/lib/fleet/costs";
import type { FleetInsight } from "@/lib/fleet/service";

/**
 * Simple, defensible observations about the fleet.
 *
 * Every insight is a deterministic calculation over real rows — the most
 * expensive vehicle this month, a vehicle with repeated open issues, and how
 * many vehicles lack the data needed to judge their service status. There is no
 * generated prose and no LLM anywhere in this component or the code feeding it.
 */
export async function FleetInsights({ items }: { items: FleetInsight[] }) {
  const t = await getTranslations("fleet.insights");
  const locale = await getLocale();

  if (items.length === 0) return null;

  return (
    <section aria-labelledby="fleet-insights-heading" className="space-y-3">
      <h2
        id="fleet-insights-heading"
        className="text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-3"
      >
        {t("heading")}
      </h2>

      <ul className="space-y-2">
        {items.map((insight) => {
          switch (insight.kind) {
            case "most_expensive_vehicle":
              return (
                <InsightRow
                  key={insight.kind}
                  href={`/vehicles/${insight.vehicleId}`}
                  text={t("mostExpensive", {
                    vehicle:
                      insight.licensePlate ||
                      insight.vehicleLabel ||
                      t("aVehicle"),
                    amount: formatCost(insight.amount, insight.currency, locale),
                  })}
                />
              );
            case "repeated_issues":
              return (
                <InsightRow
                  key={insight.kind}
                  href={`/vehicles/${insight.vehicleId}/issues`}
                  text={t("repeatedIssues", {
                    vehicle:
                      insight.licensePlate ||
                      insight.vehicleLabel ||
                      t("aVehicle"),
                    count: insight.count,
                  })}
                />
              );
            case "service_data_missing":
              return (
                <InsightRow
                  key={insight.kind}
                  href="/vehicles?filter=needs_attention"
                  text={t("serviceDataMissing", { count: insight.count })}
                />
              );
          }
        })}
      </ul>
    </section>
  );
}

function InsightRow({ href, text }: { href: string; text: string }) {
  return (
    <li>
      <Link
        href={href}
        className="block rounded-2xl border border-line bg-surface p-3.5 text-sm text-ink-2 transition hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
      >
        {text}
      </Link>
    </li>
  );
}

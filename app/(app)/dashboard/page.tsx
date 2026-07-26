import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { ActionList } from "@/components/fleet/action-list";
import { DeadlineList } from "@/components/fleet/deadline-list";
import { FleetInsights } from "@/components/fleet/fleet-insights";
import { FleetSummaryCards } from "@/components/fleet/fleet-summary-cards";
import { OrganizationMissing } from "@/components/fleet/organization-missing";
import { CarIcon, ScanIcon } from "@/components/icons";
import { OrganizationMissingError } from "@/lib/auth/errors";
import { getFleetOverview, type FleetOverview } from "@/lib/fleet/service";
import { getCurrentOrganization } from "@/lib/organizations/service";
import { createClient } from "@/lib/supabase/server";
import { redirectDriversAway } from "@/lib/drivers/guard";

/**
 * Fleet Dashboard — the operational control tower.
 *
 * ADAPTED from the previous consumer dashboard rather than added alongside it,
 * so there is still exactly one post-login home. Two consumer blocks were
 * folded in rather than kept as-is:
 *   * the "your vehicles" card grid  -> the fleet vehicles list at /vehicles
 *   * the standalone reminders block -> merged into "Upcoming maintenance &
 *     documents", which now also covers service/test/insurance/document dates
 * Both features still exist; only their presentation moved.
 */
export default async function DashboardPage() {
  // Drivers have their own screen; Fleet queries return nothing for them.
  await redirectDriversAway();

  const t = await getTranslations("fleet");
  const td = await getTranslations("dashboard");

  // A signed-in user with no organization is an explicit error state — never a
  // silent fallback to some other organization.
  let overview: FleetOverview;
  let organizationName: string | null = null;
  try {
    [overview, organizationName] = await Promise.all([
      getFleetOverview(),
      getCurrentOrganization().then((o) => o?.name ?? null),
    ]);
  } catch (error) {
    if (error instanceof OrganizationMissingError) return <OrganizationMissing />;
    throw error;
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const meta = (user?.user_metadata ?? {}) as {
    first_name?: string;
    given_name?: string;
    full_name?: string;
    name?: string;
  };
  const firstName =
    meta.first_name?.trim() ||
    meta.given_name?.trim() ||
    meta.full_name?.trim().split(/\s+/)[0] ||
    meta.name?.trim().split(/\s+/)[0] ||
    user?.email?.split("@")[0] ||
    "";

  const { summary, actions, insights, deadlines } = overview;

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        {firstName ? (
          <p className="text-sm text-ink-2">
            {td("welcome", { name: firstName })}
          </p>
        ) : null}
        <h1 className="text-2xl font-extrabold tracking-tight">{t("title")}</h1>
        <p className="text-sm text-ink-3">{organizationName ?? t("subtitle")}</p>
      </div>

      {summary.totalVehicles === 0 ? (
        <EmptyFleet />
      ) : (
        <>
          <FleetSummaryCards summary={summary} />

          <Link
            href="/scan"
            className="flex items-center justify-center gap-2 rounded-2xl bg-accent px-4 py-3.5 text-sm font-bold text-on-accent glow-accent transition hover:brightness-110 active:scale-[.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
          >
            <ScanIcon className="h-5 w-5" />
            {td("quickActions.scanDocument")}
          </Link>

          <ActionList items={actions} />
          <FleetInsights items={insights} />
          <DeadlineList items={deadlines} />
        </>
      )}
    </div>
  );
}

/** No vehicles yet — guide the user to add the first one. */
async function EmptyFleet() {
  const t = await getTranslations("fleet.emptyFleet");

  return (
    <div className="space-y-4 rounded-2xl border border-line bg-surface p-6 cockpit-lift">
      <div className="flex items-start gap-3">
        <CarIcon className="mt-0.5 h-8 w-8 shrink-0 text-ink-3" />
        <div className="space-y-1">
          <p className="text-base font-semibold">{t("heading")}</p>
          <p className="text-sm text-ink-2">{t("explainer")}</p>
        </div>
      </div>

      <ol className="space-y-2">
        {(["step1", "step2", "step3"] as const).map((step, i) => (
          <li key={step} className="flex items-start gap-3 text-sm">
            <span className="num flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent/12 text-xs font-semibold text-accent">
              {i + 1}
            </span>
            <span>{t(step)}</span>
          </li>
        ))}
      </ol>

      <Link
        href="/vehicles/new"
        className="inline-flex h-11 items-center justify-center rounded-xl bg-accent px-4 text-sm font-bold text-on-accent glow-accent transition hover:brightness-110 active:scale-[.98]"
      >
        {t("cta")}
      </Link>
    </div>
  );
}

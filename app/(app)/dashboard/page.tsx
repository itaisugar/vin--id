import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { AttentionBanner } from "@/components/fleet/attention-banner";
import { OrganizationMissing } from "@/components/fleet/organization-missing";
import { VehicleArcCard, rowUrgencyKey } from "@/components/fleet/vehicle-arc-card";
import { CarIcon, PlusIcon, ScanIcon } from "@/components/icons";
import { OrganizationMissingError } from "@/lib/auth/errors";
import { getFleetOverview, type FleetOverview } from "@/lib/fleet/service";
import {
  getCurrentOrganization,
  getCurrentRole,
  isPersonalWorkspace,
} from "@/lib/organizations/service";
import { createClient } from "@/lib/supabase/server";
import { redirectDriversAway } from "@/lib/drivers/guard";
import { canWriteFleetData } from "@/lib/organizations/types";

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

  const { summary, rows } = overview;

  // Presentation only: the intake pages and actions re-check this server-side.
  const role = await getCurrentRole();
  const canWrite = role != null && canWriteFleetData(role);
  // A personal workspace is "your vehicles"; a business workspace is "your fleet".
  const personal = await isPersonalWorkspace();
  const tv = await getTranslations("vehicles");

  // Urgency-first, then more actions, then plate — the same intent as the fleet
  // list's default sort. At most four cards; "View all" leads to the full list.
  const preview = [...rows]
    .sort((a, b) => {
      const byUrgency = rowUrgencyKey(a) - rowUrgencyKey(b);
      if (byUrgency !== 0) return byUrgency;
      const byCount = b.actions.length - a.actions.length;
      if (byCount !== 0) return byCount;
      return (a.vehicle.license_plate ?? "").localeCompare(
        b.vehicle.license_plate ?? "",
      );
    })
    .slice(0, 4);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-4">
        <div className="min-w-0 space-y-1">
          {firstName ? (
            <p className="text-sm text-ink-2">
              {td("welcome", { name: firstName })}
            </p>
          ) : null}
          <h1 className="text-2xl font-extrabold tracking-tight">
            {personal ? td("titlePersonal") : td("titleBusiness")}
          </h1>
          <p className="text-sm text-ink-3">
            {organizationName ?? t("subtitle")}
          </p>
        </div>

        {/* Write CTAs — writer-only and only once there is a fleet to act on;
            an empty workspace is guided by EmptyFleet instead. */}
        {summary.totalVehicles > 0 && canWrite ? (
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href="/fleet-intake"
              className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-accent px-4 text-sm font-bold text-on-accent glow-accent transition hover:brightness-110 active:scale-[.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
            >
              <ScanIcon className="h-5 w-5" />
              {td("quickActions.scanDocument")}
            </Link>
            <Link
              href="/vehicles/new"
              className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-line bg-surface px-4 text-sm font-semibold text-ink transition hover:bg-surface-2 active:scale-[.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
            >
              <PlusIcon className="h-5 w-5" />
              {tv("addVehicle")}
            </Link>
          </div>
        ) : null}
      </div>

      {summary.totalVehicles === 0 ? (
        <EmptyFleet />
      ) : (
        <>
          {/* One compact attention surface, or a quiet all-clear line. */}
          <AttentionBanner rows={rows} />

          {/* Vehicles — the dominant content. */}
          <section
            aria-labelledby="dashboard-vehicles-heading"
            className="space-y-3"
          >
            <div className="flex items-baseline justify-between gap-3">
              <h2
                id="dashboard-vehicles-heading"
                className="flex items-baseline gap-2 text-lg font-extrabold tracking-tight"
              >
                {td("vehicles.heading")}
                <span className="num text-sm font-semibold text-ink-3">
                  {summary.totalVehicles}
                </span>
              </h2>
              <Link
                href="/vehicles"
                className="shrink-0 rounded text-sm font-medium text-accent transition hover:text-glow-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
              >
                {td("vehicles.viewAll")}
              </Link>
            </div>

            <ul className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              {preview.map((r) => (
                <li key={r.vehicle.id} className="h-full">
                  <VehicleArcCard row={r} />
                </li>
              ))}
            </ul>
          </section>
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

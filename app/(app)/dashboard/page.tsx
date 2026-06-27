import Link from "next/link";
import { getTranslations } from "next-intl/server";
import {
  CarIcon,
  PassportIcon,
  ScanIcon,
  WrenchIcon,
} from "@/components/icons";
import { DashboardReminders } from "@/components/reminders/dashboard-reminders";
import { VehicleCard } from "@/components/vehicles/vehicle-card";
import { createClient } from "@/lib/supabase/server";
import { listVehicles } from "@/lib/vehicles/service";

const VEHICLE_LIMIT = 4;

// COCKPIT quick-action tile: icon over label. The leading "Scan" tile is the
// amber primary action; the rest are raised surface controls.
const ACTION_TILE_BASE =
  "flex flex-col items-center justify-center gap-2 rounded-2xl px-3 py-4 text-center text-xs font-bold transition active:scale-[.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg";
const ACTION_TILE_PRIMARY = "bg-accent text-on-accent glow-accent";
const ACTION_TILE_SECONDARY =
  "border border-line bg-surface-2 text-ink hover:bg-surface";

export default async function DashboardPage() {
  const t = await getTranslations("dashboard");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const vehicles = await listVehicles();
  const active = vehicles.filter((v) => v.status === "active");
  const primary = active[0] ?? null;

  // Prefer the user's first name (from signup metadata, or Google's profile).
  // Fall back to the email's local part so we never greet with the full email.
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

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        {firstName ? (
          <p className="text-sm text-ink-2">{t("welcome", { name: firstName })}</p>
        ) : null}
        <h1 className="text-2xl font-extrabold tracking-tight">{t("title")}</h1>
        <p className="text-sm text-ink-3">{t("subtitle")}</p>
      </div>

      {vehicles.length === 0 ? (
        /* First-time onboarding */
        <div className="space-y-4 rounded-2xl border border-line bg-surface p-6 cockpit-lift">
          <div className="flex items-start gap-3">
            <CarIcon className="mt-0.5 h-8 w-8 shrink-0 text-ink-3" />
            <div className="space-y-1">
              <p className="text-base font-semibold">{t("onboarding.heading")}</p>
              <p className="text-sm text-ink-2">{t("onboarding.explainer")}</p>
            </div>
          </div>

          <ol className="space-y-2">
            {(["step1", "step2", "step3"] as const).map((step, i) => (
              <li key={step} className="flex items-start gap-3 text-sm">
                <span className="num flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent/12 text-xs font-semibold text-accent">
                  {i + 1}
                </span>
                <span>{t(`onboarding.${step}`)}</span>
              </li>
            ))}
          </ol>

          <Link
            href="/vehicles/new"
            className="inline-flex h-11 items-center justify-center rounded-xl bg-accent px-4 text-sm font-bold text-on-accent glow-accent transition hover:brightness-110 active:scale-[.98]"
          >
            {t("onboarding.cta")}
          </Link>
        </div>
      ) : (
        <>
          {/* Quick actions — fixed order: Scan a document (amber primary) →
              Create passport → Add maintenance. All but Scan need a vehicle, so
              they render only when an active vehicle exists; /scan handles its
              own vehicle pick. Scan is the single way to bring in a document. */}
          <section className="space-y-3">
            <h2 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-3">
              {t("quickActions.title")}
            </h2>
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
              <Link
                href="/scan"
                className={`${ACTION_TILE_BASE} ${ACTION_TILE_PRIMARY}`}
              >
                <ScanIcon className="h-6 w-6" />
                {t("quickActions.scanDocument")}
              </Link>
              {primary ? (
                <>
                  <Link
                    href={`/vehicles/${primary.id}/passports/new`}
                    className={`${ACTION_TILE_BASE} ${ACTION_TILE_SECONDARY}`}
                  >
                    <PassportIcon className="h-6 w-6 text-accent" />
                    {t("quickActions.createPassport")}
                  </Link>
                  <Link
                    href={`/vehicles/${primary.id}/maintenance/new`}
                    className={`${ACTION_TILE_BASE} ${ACTION_TILE_SECONDARY}`}
                  >
                    <WrenchIcon className="h-6 w-6 text-accent" />
                    {t("quickActions.addMaintenance")}
                  </Link>
                </>
              ) : null}
            </div>
          </section>

          {/* Your vehicles */}
          <section className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-3">
                {t("yourVehicles.title")}
              </h2>
              <Link
                href="/vehicles"
                className="text-sm font-medium text-accent hover:underline"
              >
                {t("yourVehicles.viewAll", { count: vehicles.length })}
              </Link>
            </div>
            {active.length === 0 ? (
              <p className="text-sm text-ink-2">
                {t("yourVehicles.noneActive")}
              </p>
            ) : (
              <div className="grid gap-3">
                {active.slice(0, VEHICLE_LIMIT).map((v) => (
                  <VehicleCard key={v.id} vehicle={v} />
                ))}
              </div>
            )}
          </section>

          {/* Upcoming/urgent reminders across active vehicles */}
          <DashboardReminders />
        </>
      )}
    </div>
  );
}

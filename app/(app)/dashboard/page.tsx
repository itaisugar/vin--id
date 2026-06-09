import Link from "next/link";
import { getTranslations } from "next-intl/server";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { CarIcon } from "@/components/icons";
import { DashboardReminders } from "@/components/reminders/dashboard-reminders";
import { VehicleCard } from "@/components/vehicles/vehicle-card";
import { createClient } from "@/lib/supabase/server";
import { listVehicles } from "@/lib/vehicles/service";

const VEHICLE_LIMIT = 4;

const ACTION_CLASS =
  "inline-flex h-10 items-center justify-center rounded-md border border-border px-4 text-sm font-medium transition-colors hover:bg-muted";

export default async function DashboardPage() {
  const t = await getTranslations("dashboard");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const vehicles = await listVehicles();
  const active = vehicles.filter((v) => v.status === "active");
  const primary = active[0] ?? null;

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-bold">{t("title")}</h1>
        {user?.email ? (
          <p className="text-muted-foreground">
            {t("welcome", { email: user.email })}
          </p>
        ) : null}
        <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
      </div>

      {vehicles.length === 0 ? (
        /* First-time onboarding */
        <div className="space-y-4 rounded-lg border border-border bg-background p-6">
          <div className="flex items-start gap-3">
            <CarIcon className="mt-0.5 h-8 w-8 shrink-0 text-muted-foreground" />
            <div className="space-y-1">
              <p className="text-base font-semibold">{t("onboarding.heading")}</p>
              <p className="text-sm text-muted-foreground">
                {t("onboarding.explainer")}
              </p>
            </div>
          </div>

          <ol className="space-y-2">
            {(["step1", "step2", "step3"] as const).map((step, i) => (
              <li key={step} className="flex items-start gap-3 text-sm">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                  {i + 1}
                </span>
                <span>{t(`onboarding.${step}`)}</span>
              </li>
            ))}
          </ol>

          <Link
            href="/vehicles/new"
            className="inline-flex h-10 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:opacity-90"
          >
            {t("onboarding.cta")}
          </Link>
        </div>
      ) : (
        <>
          {/* Quick actions */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                {t("quickActions.title")}
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              <Link href="/vehicles/new" className={ACTION_CLASS}>
                {t("quickActions.addVehicle")}
              </Link>
              <Link href="/diagnose" className={ACTION_CLASS}>
                {t("quickActions.diagnose")}
              </Link>
              {primary ? (
                <>
                  <Link
                    href={`/vehicles/${primary.id}/maintenance/new`}
                    className={ACTION_CLASS}
                  >
                    {t("quickActions.addMaintenance")}
                  </Link>
                  <Link
                    href={`/vehicles/${primary.id}/documents/new`}
                    className={ACTION_CLASS}
                  >
                    {t("quickActions.uploadDocument")}
                  </Link>
                  <Link
                    href={`/vehicles/${primary.id}/passports/new`}
                    className={ACTION_CLASS}
                  >
                    {t("quickActions.createPassport")}
                  </Link>
                </>
              ) : null}
            </CardContent>
          </Card>

          {/* Your vehicles */}
          <section className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-sm font-semibold text-muted-foreground">
                {t("yourVehicles.title")}
              </h2>
              <Link
                href="/vehicles"
                className="text-sm font-medium text-primary hover:underline"
              >
                {t("yourVehicles.viewAll", { count: vehicles.length })}
              </Link>
            </div>
            {active.length === 0 ? (
              <p className="text-sm text-muted-foreground">
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

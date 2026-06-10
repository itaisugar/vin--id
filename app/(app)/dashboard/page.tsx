import Link from "next/link";
import { getTranslations } from "next-intl/server";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { DashboardReminders } from "@/components/reminders/dashboard-reminders";
import { OnboardingChecklist } from "@/components/dashboard/onboarding-checklist";
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

  // Onboarding completion is derived from existing data (owner-scoped counts).
  const [maintenance, documents, passports] = await Promise.all([
    supabase
      .from("maintenance_logs")
      .select("id", { count: "exact", head: true })
      .is("deleted_at", null),
    supabase
      .from("vehicle_documents")
      .select("id", { count: "exact", head: true })
      .is("deleted_at", null),
    supabase
      .from("vehicle_passports")
      .select("id", { count: "exact", head: true })
      .is("deleted_at", null),
  ]);
  const counts = {
    vehicles: vehicles.length,
    maintenance: maintenance.count ?? 0,
    documents: documents.count ?? 0,
    passports: passports.count ?? 0,
  };
  const onboarded =
    counts.vehicles > 0 &&
    counts.maintenance > 0 &&
    counts.documents > 0 &&
    counts.passports > 0;

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

      {!onboarded ? (
        <OnboardingChecklist
          counts={counts}
          primaryVehicleId={primary?.id ?? null}
        />
      ) : null}

      {vehicles.length > 0 ? (
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
              <Link href="/scan" className={ACTION_CLASS}>
                {t("quickActions.scanDocument")}
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
      ) : null}
    </div>
  );
}

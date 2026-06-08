import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { DiagnoseForm } from "@/components/diagnosis/diagnose-form";
import { SessionCard } from "@/components/diagnosis/session-card";
import { listSessions } from "@/lib/diagnosis/service";
import { listVehicles } from "@/lib/vehicles/service";

export default async function DiagnosePage({
  searchParams,
}: PageProps<"/diagnose">) {
  const { vehicle } = await searchParams;
  const t = await getTranslations("diagnose");

  const [vehicles, sessions] = await Promise.all([
    listVehicles(),
    listSessions(),
  ]);

  const options = vehicles.map((v) => ({
    id: v.id,
    label: [v.make, v.model].filter(Boolean).join(" ").trim() || v.id.slice(0, 8),
    currentMileage: v.current_mileage,
  }));
  const defaultVehicleId = typeof vehicle === "string" ? vehicle : undefined;

  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <div className="space-y-1">
        <h1 className="text-2xl font-bold">{t("title")}</h1>
        <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
      </div>

      <p className="rounded-md border border-border bg-muted px-3 py-2 text-xs text-muted-foreground">
        {t("safetyIntro")}
      </p>

      {options.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border p-12 text-center">
          <p className="font-medium">{t("noVehicles.title")}</p>
          <p className="max-w-sm text-sm text-muted-foreground">
            {t("noVehicles.body")}
          </p>
          <Link
            href="/vehicles/new"
            className="inline-flex h-10 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:opacity-90"
          >
            {t("noVehicles.cta")}
          </Link>
        </div>
      ) : (
        <DiagnoseForm
          vehicles={options}
          defaultVehicleId={defaultVehicleId}
          cancelHref="/dashboard"
        />
      )}

      {sessions.length > 0 ? (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-muted-foreground">
            {t("history.title")}
          </h2>
          <div className="grid gap-3">
            {sessions.map((session) => (
              <SessionCard key={session.id} session={session} />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

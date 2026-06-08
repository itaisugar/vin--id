import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { CarIcon } from "@/components/icons";
import { VehicleCard } from "@/components/vehicles/vehicle-card";
import { listVehicles } from "@/lib/vehicles/service";

export default async function VehiclesPage() {
  const t = await getTranslations("vehicles");
  const vehicles = await listVehicles();

  const active = vehicles.filter((v) => v.status === "active");
  const inactive = vehicles.filter((v) => v.status !== "active");

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-bold">{t("title")}</h1>
        <Link
          href="/vehicles/new"
          className="inline-flex h-10 shrink-0 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:opacity-90"
        >
          {t("addVehicle")}
        </Link>
      </div>

      {vehicles.length === 0 ? (
        <EmptyState
          title={t("empty.title")}
          body={t("empty.body")}
          cta={t("addVehicle")}
        />
      ) : (
        <div className="space-y-8">
          <section className="space-y-3">
            <h2 className="text-sm font-semibold text-muted-foreground">
              {t("sections.active")} ({active.length})
            </h2>
            {active.length > 0 ? (
              <div className="grid gap-3">
                {active.map((v) => (
                  <VehicleCard key={v.id} vehicle={v} />
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                {t("sections.noActive")}
              </p>
            )}
          </section>

          {inactive.length > 0 ? (
            <section className="space-y-3">
              <h2 className="text-sm font-semibold text-muted-foreground">
                {t("sections.archivedSold")} ({inactive.length})
              </h2>
              <div className="grid gap-3">
                {inactive.map((v) => (
                  <VehicleCard key={v.id} vehicle={v} />
                ))}
              </div>
            </section>
          ) : null}
        </div>
      )}
    </div>
  );
}

function EmptyState({
  title,
  body,
  cta,
}: {
  title: string;
  body: string;
  cta: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-4 rounded-lg border border-dashed border-border p-12 text-center">
      <CarIcon className="h-10 w-10 text-muted-foreground" />
      <div className="space-y-1">
        <p className="font-medium">{title}</p>
        <p className="max-w-sm text-sm text-muted-foreground">{body}</p>
      </div>
      <Link
        href="/vehicles/new"
        className="inline-flex h-10 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:opacity-90"
      >
        {cta}
      </Link>
    </div>
  );
}

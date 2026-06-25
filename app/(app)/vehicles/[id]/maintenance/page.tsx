import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { MaintenanceListItem } from "@/components/maintenance/maintenance-list-item";
import { listMaintenanceLogs } from "@/lib/maintenance/service";
import { getVehicleById } from "@/lib/vehicles/service";

export default async function MaintenanceListPage({
  params,
}: PageProps<"/vehicles/[id]/maintenance">) {
  const { id } = await params;
  const t = await getTranslations("maintenance");

  const vehicle = await getVehicleById(id);
  if (!vehicle) notFound();

  const logs = await listMaintenanceLogs(id);
  const vehicleTitle =
    [vehicle.make, vehicle.model].filter(Boolean).join(" ").trim();

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <Link
            href={`/vehicles/${id}`}
            className="inline-flex items-center gap-1 text-sm text-ink-2 hover:text-ink"
          >
            <span className="inline-block rtl:rotate-180">←</span> {vehicleTitle || t("backToVehicle")}
          </Link>
          <h1 className="text-2xl font-extrabold tracking-tight">{t("title")}</h1>
        </div>
        <Link
          href={`/vehicles/${id}/maintenance/new`}
          className="inline-flex h-10 shrink-0 items-center justify-center rounded-xl bg-accent px-4 text-sm font-semibold text-on-accent transition-transform active:scale-[.98]"
        >
          {t("addMaintenance")}
        </Link>
      </div>

      {logs.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-line p-12 text-center">
          <p className="font-medium">{t("empty.title")}</p>
          <p className="max-w-sm text-sm text-ink-2">
            {t("empty.body")}
          </p>
          <Link
            href={`/vehicles/${id}/maintenance/new`}
            className="inline-flex h-10 items-center justify-center rounded-xl bg-accent px-4 text-sm font-semibold text-on-accent transition-transform active:scale-[.98]"
          >
            {t("addMaintenance")}
          </Link>
        </div>
      ) : (
        <div className="grid gap-3">
          {logs.map((log) => (
            <MaintenanceListItem
              key={log.id}
              vehicleId={id}
              log={log}
              mileageUnit={vehicle.mileage_unit}
            />
          ))}
        </div>
      )}
    </div>
  );
}

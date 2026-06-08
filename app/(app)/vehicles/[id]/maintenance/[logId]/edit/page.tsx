import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { updateMaintenanceAction } from "../../actions";
import { MaintenanceForm } from "@/components/maintenance/maintenance-form";
import {
  getMaintenanceLog,
} from "@/lib/maintenance/service";
import { maintenanceToFormValues } from "@/lib/maintenance/types";
import { getVehicleById } from "@/lib/vehicles/service";

export default async function EditMaintenancePage({
  params,
}: PageProps<"/vehicles/[id]/maintenance/[logId]/edit">) {
  const { id, logId } = await params;
  const t = await getTranslations("maintenance");

  const vehicle = await getVehicleById(id);
  if (!vehicle) notFound();

  const log = await getMaintenanceLog(id, logId);
  if (!log) notFound();

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <h1 className="text-2xl font-bold">{t("edit.title")}</h1>
      <MaintenanceForm
        mode="edit"
        defaultValues={maintenanceToFormValues(log)}
        action={updateMaintenanceAction.bind(null, id, logId)}
        cancelHref={`/vehicles/${id}/maintenance`}
      />
    </div>
  );
}

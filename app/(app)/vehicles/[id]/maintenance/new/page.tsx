import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { createMaintenanceAction } from "../actions";
import { MaintenanceForm } from "@/components/maintenance/maintenance-form";
import { getVehicleById } from "@/lib/vehicles/service";

export default async function NewMaintenancePage({
  params,
}: PageProps<"/vehicles/[id]/maintenance/new">) {
  const { id } = await params;
  const t = await getTranslations("maintenance");

  // Verify the vehicle belongs to the user before showing the form.
  const vehicle = await getVehicleById(id);
  if (!vehicle) notFound();

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-bold">{t("new.title")}</h1>
        <p className="text-sm text-muted-foreground">{t("new.subtitle")}</p>
      </div>
      <MaintenanceForm
        mode="create"
        action={createMaintenanceAction.bind(null, id)}
        cancelHref={`/vehicles/${id}/maintenance`}
      />
    </div>
  );
}

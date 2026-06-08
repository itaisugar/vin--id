import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { updateVehicleAction } from "../../actions";
import { VehicleForm } from "@/components/vehicles/vehicle-form";
import { getVehicleById } from "@/lib/vehicles/service";
import { vehicleToFormValues } from "@/lib/vehicles/types";

export default async function EditVehiclePage({
  params,
}: PageProps<"/vehicles/[id]/edit">) {
  const { id } = await params;
  const t = await getTranslations("vehicles");

  const vehicle = await getVehicleById(id);
  if (!vehicle) notFound();

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <h1 className="text-2xl font-bold">{t("edit.title")}</h1>
      <VehicleForm
        mode="edit"
        defaultValues={vehicleToFormValues(vehicle)}
        action={updateVehicleAction.bind(null, vehicle.id)}
        cancelHref={`/vehicles/${vehicle.id}`}
      />
    </div>
  );
}

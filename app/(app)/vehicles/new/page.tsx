import { getTranslations } from "next-intl/server";
import { createVehicleAction } from "../actions";
import { VehicleForm } from "@/components/vehicles/vehicle-form";
import { redirectDriversAway } from "@/lib/drivers/guard";

export default async function NewVehiclePage() {
  // Drivers have their own screen; Fleet queries return nothing for them.
  await redirectDriversAway();

  const t = await getTranslations("vehicles");

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-bold">{t("new.title")}</h1>
        <p className="text-sm text-ink-2">{t("new.subtitle")}</p>
      </div>
      <VehicleForm
        mode="create"
        action={createVehicleAction}
        cancelHref="/vehicles"
      />
    </div>
  );
}

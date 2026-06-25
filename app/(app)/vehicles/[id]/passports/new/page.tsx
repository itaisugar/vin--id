import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { CreatePassportForm } from "@/components/passports/create-passport-form";
import { getPassportCounts } from "@/lib/passports/service";
import { getVehicleById } from "@/lib/vehicles/service";

export default async function NewPassportPage({
  params,
}: PageProps<"/vehicles/[id]/passports/new">) {
  const { id } = await params;
  const t = await getTranslations("passports");

  const vehicle = await getVehicleById(id);
  if (!vehicle) notFound();

  const counts = await getPassportCounts(id);

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-bold">{t("create.title")}</h1>
        <p className="text-sm text-ink-2">{t("create.subtitle")}</p>
      </div>
      <CreatePassportForm
        vehicleId={id}
        counts={counts}
        cancelHref={`/vehicles/${id}`}
      />
    </div>
  );
}

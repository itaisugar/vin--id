import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { DocumentForm } from "@/components/documents/document-form";
import { getVehicleById } from "@/lib/vehicles/service";

export default async function NewDocumentPage({
  params,
}: PageProps<"/vehicles/[id]/documents/new">) {
  const { id } = await params;
  const t = await getTranslations("documents");

  const vehicle = await getVehicleById(id);
  if (!vehicle) notFound();

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-bold">{t("new.title")}</h1>
        <p className="text-sm text-ink-2">{t("new.subtitle")}</p>
      </div>
      <DocumentForm
        mode="create"
        vehicleId={id}
        cancelHref={`/vehicles/${id}/documents`}
      />
    </div>
  );
}

import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { DocumentListItem } from "@/components/documents/document-list-item";
import { listDocuments } from "@/lib/documents/service";
import { getVehicleById } from "@/lib/vehicles/service";

export default async function DocumentsListPage({
  params,
}: PageProps<"/vehicles/[id]/documents">) {
  const { id } = await params;
  const t = await getTranslations("documents");

  const vehicle = await getVehicleById(id);
  if (!vehicle) notFound();

  const documents = await listDocuments(id);
  const vehicleTitle =
    [vehicle.make, vehicle.model].filter(Boolean).join(" ").trim();

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <Link
            href={`/vehicles/${id}`}
            className="text-sm text-muted-foreground hover:underline"
          >
            ← {vehicleTitle || t("backToVehicle")}
          </Link>
          <h1 className="text-2xl font-bold">{t("title")}</h1>
        </div>
        <Link
          href={`/vehicles/${id}/documents/new`}
          className="inline-flex h-10 shrink-0 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:opacity-90"
        >
          {t("uploadDocument")}
        </Link>
      </div>

      {documents.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border p-12 text-center">
          <p className="font-medium">{t("empty.title")}</p>
          <p className="max-w-sm text-sm text-muted-foreground">
            {t("empty.body")}
          </p>
          <Link
            href={`/vehicles/${id}/documents/new`}
            className="inline-flex h-10 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:opacity-90"
          >
            {t("uploadDocument")}
          </Link>
        </div>
      ) : (
        <div className="grid gap-3">
          {documents.map((doc) => (
            <DocumentListItem key={doc.id} vehicleId={id} doc={doc} />
          ))}
        </div>
      )}
    </div>
  );
}

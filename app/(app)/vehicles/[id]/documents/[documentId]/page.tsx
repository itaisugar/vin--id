import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { DocumentForm } from "@/components/documents/document-form";
import { DeleteDocumentButton } from "@/components/documents/delete-document-button";
import {
  getDocument,
  getDocumentSignedUrl,
} from "@/lib/documents/service";
import { documentToFormValues, isImageMime } from "@/lib/documents/types";
import { getVehicleById } from "@/lib/vehicles/service";

export default async function DocumentDetailPage({
  params,
}: PageProps<"/vehicles/[id]/documents/[documentId]">) {
  const { id, documentId } = await params;
  const t = await getTranslations("documents");

  const vehicle = await getVehicleById(id);
  if (!vehicle) notFound();

  const doc = await getDocument(id, documentId);
  if (!doc) notFound();

  const signedUrl = await getDocumentSignedUrl(id, documentId);
  const isImage = doc.mime_type ? isImageMime(doc.mime_type) : false;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="space-y-1">
        <Link
          href={`/vehicles/${id}/documents`}
          className="text-sm text-muted-foreground hover:underline"
        >
          ← {t("title")}
        </Link>
        <h1 className="truncate text-2xl font-bold">
          {doc.file_name ?? t("untitled")}
        </h1>
      </div>

      {/* Preview / download via signed URL only */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("preview.title")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {signedUrl ? (
            isImage ? (
              <a href={signedUrl} target="_blank" rel="noopener noreferrer">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={signedUrl}
                  alt={doc.file_name ?? ""}
                  className="max-h-96 w-full rounded-md border border-border object-contain"
                />
              </a>
            ) : (
              <a
                href={signedUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex h-10 items-center justify-center rounded-md border border-border px-4 text-sm font-medium transition-colors hover:bg-muted"
              >
                {t("preview.open")}
              </a>
            )
          ) : (
            <p className="text-sm text-muted-foreground">
              {t("preview.unavailable")}
            </p>
          )}
          <p className="text-xs text-muted-foreground">{t("preview.expires")}</p>

          {/* AI extraction placeholder — not implemented yet. */}
          <div className="rounded-md border border-dashed border-border p-3">
            <button
              type="button"
              disabled
              className="inline-flex h-9 cursor-not-allowed items-center justify-center rounded-md border border-border px-3 text-sm font-medium opacity-60"
            >
              {t("ai.extract")}
            </button>
            <p className="mt-2 text-xs text-muted-foreground">{t("ai.help")}</p>
          </div>
        </CardContent>
      </Card>

      {/* Metadata edit */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
          <CardTitle className="text-base">{t("edit.title")}</CardTitle>
          <DeleteDocumentButton vehicleId={id} documentId={documentId} />
        </CardHeader>
        <CardContent>
          <DocumentForm
            mode="edit"
            vehicleId={id}
            documentId={documentId}
            defaultValues={documentToFormValues(doc)}
            cancelHref={`/vehicles/${id}/documents`}
          />
        </CardContent>
      </Card>
    </div>
  );
}

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
import { ExtractWithAiButton } from "@/components/documents/extract-with-ai-button";
import { ExtractionReview } from "@/components/documents/extraction-review";
import {
  getDocument,
  getDocumentSignedUrl,
} from "@/lib/documents/service";
import { getLatestPendingExtraction } from "@/lib/documents/extraction-service";
import { extractionResultSchema } from "@/lib/documents/extraction-types";
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

  // Pending mock extraction (if any) drives the review panel.
  const pending = await getLatestPendingExtraction(documentId);
  const pendingResult = pending
    ? (extractionResultSchema.safeParse(pending.extracted_data).data ?? null)
    : null;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="space-y-1">
        <Link
          href={`/vehicles/${id}/documents`}
          className="inline-flex items-center gap-1 text-sm text-ink-2 hover:text-ink"
        >
          <span className="inline-block rtl:rotate-180">←</span> {t("title")}
        </Link>
        <h1 className="truncate text-2xl font-extrabold tracking-tight">
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
                  className="max-h-96 w-full rounded-xl border border-line object-contain"
                />
              </a>
            ) : (
              <a
                href={signedUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex h-10 items-center justify-center rounded-xl border border-line bg-surface-2 px-4 text-sm font-medium transition-colors hover:bg-surface active:scale-[.98]"
              >
                {t("preview.open")}
              </a>
            )
          ) : (
            <p className="text-sm text-ink-2">
              {t("preview.unavailable")}
            </p>
          )}
          <p className="text-xs text-ink-2">{t("preview.expires")}</p>

          {/* MOCK extraction — entry point only (review panel renders below). */}
          {!pendingResult ? (
            <ExtractWithAiButton vehicleId={id} documentId={documentId} />
          ) : null}
        </CardContent>
      </Card>

      {/* Extraction review (pending, requires confirmation) */}
      {pending && pendingResult ? (
        <ExtractionReview
          vehicleId={id}
          documentId={documentId}
          extractionId={pending.id}
          result={pendingResult}
          fallback={{
            document_type: doc.doc_type,
            document_date: doc.document_date,
            expiry_date: doc.expiry_date,
            vendor: doc.vendor,
            amount: doc.amount,
            currency: doc.currency,
          }}
          containsPersonalInfo={doc.contains_personal_info}
        />
      ) : null}

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

"use client";

import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { DeleteDocumentButton } from "@/components/documents/delete-document-button";
import { TrustLabelBadge } from "@/components/documents/trust-label-badge";
import type { VehicleDocument } from "@/lib/documents/types";

export function DocumentListItem({
  vehicleId,
  doc,
}: {
  vehicleId: string;
  doc: VehicleDocument;
}) {
  const t = useTranslations("documents");
  const locale = useLocale();

  const fmtDate = (d: string | null) =>
    d
      ? new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(
          new Date(d),
        )
      : null;

  const amount =
    doc.amount != null
      ? new Intl.NumberFormat(locale, {
          style: "currency",
          currency: doc.currency || "ILS",
          maximumFractionDigits: 2,
        }).format(doc.amount)
      : null;

  const meta = [
    fmtDate(doc.document_date),
    doc.vendor,
    amount,
    doc.expiry_date ? `${t("fields.expiryDate")}: ${fmtDate(doc.expiry_date)}` : null,
  ].filter(Boolean);

  const detailHref = `/vehicles/${vehicleId}/documents/${doc.id}`;
  const showPrivacyWarning = doc.contains_personal_info && doc.share_allowed;

  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="muted">{t(`documentTypes.${doc.doc_type}`)}</Badge>
            <TrustLabelBadge level={doc.trust_label} />
            {doc.contains_personal_info ? (
              <Badge tone="warning">{t("badges.personalInfo")}</Badge>
            ) : null}
            {doc.share_allowed ? (
              <Badge tone="neutral">{t("badges.shareable")}</Badge>
            ) : null}
          </div>
          <Link href={detailHref} className="block hover:underline">
            <p className="truncate text-sm font-medium">
              {doc.file_name ?? t("untitled")}
            </p>
          </Link>
          {meta.length > 0 ? (
            <p className="truncate text-xs text-ink-2">{meta.join(" · ")}</p>
          ) : null}
          {showPrivacyWarning ? (
            <p className="text-xs text-warn">
              {t("privacyWarning")}
            </p>
          ) : null}
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <Link
            href={detailHref}
            className="inline-flex h-8 items-center justify-center rounded-xl px-3 text-xs font-medium text-ink-2 transition-colors hover:bg-surface-2"
          >
            {t("viewEdit")}
          </Link>
          <DeleteDocumentButton vehicleId={vehicleId} documentId={doc.id} />
        </div>
      </div>
    </Card>
  );
}

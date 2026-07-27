import { getLocale, getTranslations } from "next-intl/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { DriverDocument } from "@/lib/drivers/types";

/**
 * Documents a manager explicitly shared with this driver.
 *
 * The list holds no `storage_path`, `amount`, `currency` or `vendor` — the RPC
 * that produced it does not return them. Opening a file goes through the view
 * route, which mints a short-lived signed URL server-side after re-checking the
 * driver's active assignment.
 */
export async function DriverDocumentList({
  documents,
}: {
  documents: DriverDocument[];
}) {
  const t = await getTranslations("driver.documents");
  const locale = await getLocale();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t("title")}</CardTitle>
      </CardHeader>
      <CardContent className="p-4 pt-0">
        {documents.length === 0 ? (
          <p className="text-sm text-ink-2">{t("empty")}</p>
        ) : (
          <ul className="divide-y divide-line">
            {documents.map((doc) => (
              <li
                key={doc.id}
                className="flex flex-wrap items-center justify-between gap-3 py-3"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {doc.title ?? doc.file_name ?? t("untitled")}
                  </p>
                  <p className="mt-0.5 text-xs text-ink-3">
                    {[
                      doc.doc_type,
                      doc.document_date
                        ? new Intl.DateTimeFormat(locale, {
                            dateStyle: "medium",
                          }).format(new Date(doc.document_date))
                        : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </div>
                <a
                  href={`/my-vehicle/documents/${doc.id}/view`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="shrink-0 rounded-xl border border-line px-3 py-1.5 text-xs font-medium text-ink-2 transition hover:bg-surface-2 hover:text-ink"
                >
                  {t("open")}
                </a>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

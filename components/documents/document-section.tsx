import Link from "next/link";
import { getTranslations } from "next-intl/server";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { DocumentListItem } from "@/components/documents/document-list-item";
import type { VehicleDocument } from "@/lib/documents/types";

const RECENT_LIMIT = 3;

/** Documents summary shown on the vehicle detail page. */
export async function DocumentSection({
  vehicleId,
  documents,
}: {
  vehicleId: string;
  documents: VehicleDocument[];
}) {
  const t = await getTranslations("documents");
  const recent = documents.slice(0, RECENT_LIMIT);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
        <CardTitle>{t("title")}</CardTitle>
        <Link
          href={`/vehicles/${vehicleId}/documents/new`}
          className="inline-flex h-9 shrink-0 items-center justify-center rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground transition-colors hover:opacity-90"
        >
          {t("uploadDocument")}
        </Link>
      </CardHeader>
      <CardContent className="space-y-3">
        {recent.length === 0 ? (
          <p className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            {t("empty.body")}
          </p>
        ) : (
          <>
            <div className="grid gap-3">
              {recent.map((doc) => (
                <DocumentListItem
                  key={doc.id}
                  vehicleId={vehicleId}
                  doc={doc}
                />
              ))}
            </div>
            <Link
              href={`/vehicles/${vehicleId}/documents`}
              className="inline-block text-sm font-medium text-primary hover:underline"
            >
              {t("viewAll", { count: documents.length })}
            </Link>
          </>
        )}
      </CardContent>
    </Card>
  );
}

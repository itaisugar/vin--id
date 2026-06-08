import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { IssueListItem } from "@/components/issues/issue-list-item";
import { listIssues } from "@/lib/issues/service";
import { getVehicleById } from "@/lib/vehicles/service";

export default async function IssuesListPage({
  params,
}: PageProps<"/vehicles/[id]/issues">) {
  const { id } = await params;
  const t = await getTranslations("issues");

  const vehicle = await getVehicleById(id);
  if (!vehicle) notFound();

  const issues = await listIssues(id);
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
          href={`/vehicles/${id}/issues/new`}
          className="inline-flex h-10 shrink-0 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:opacity-90"
        >
          {t("addIssue")}
        </Link>
      </div>

      {issues.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border p-12 text-center">
          <p className="font-medium">{t("empty.title")}</p>
          <p className="max-w-sm text-sm text-muted-foreground">
            {t("empty.body")}
          </p>
          <Link
            href={`/vehicles/${id}/issues/new`}
            className="inline-flex h-10 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:opacity-90"
          >
            {t("addIssue")}
          </Link>
        </div>
      ) : (
        <div className="grid gap-3">
          {issues.map((issue) => (
            <IssueListItem
              key={issue.id}
              vehicleId={id}
              issue={issue}
              mileageUnit={vehicle.mileage_unit}
            />
          ))}
        </div>
      )}
    </div>
  );
}

import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { ScanFlow } from "@/components/scan/scan-flow";
import { listVehicles } from "@/lib/vehicles/service";

/**
 * Scan a document → AI extraction → confirm → create a maintenance/issue record.
 * The image is sent to the provider server-side (never the browser) and only the
 * user-confirmed record is saved.
 */
export default async function ScanPage({ searchParams }: PageProps<"/scan">) {
  const { vehicle } = await searchParams;
  const t = await getTranslations("scan");

  const vehicles = await listVehicles();
  const active = vehicles.filter((v) => v.status === "active");
  const options = active.map((v) => ({
    id: v.id,
    label:
      [v.make, v.model].filter(Boolean).join(" ").trim() || v.id.slice(0, 8),
  }));
  const defaultVehicleId = typeof vehicle === "string" ? vehicle : undefined;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-bold">{t("title")}</h1>
        <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
      </div>

      {options.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border p-12 text-center">
          <p className="font-medium">{t("noVehicles.title")}</p>
          <p className="max-w-sm text-sm text-muted-foreground">
            {t("noVehicles.body")}
          </p>
          <Link
            href="/vehicles/new"
            className="inline-flex h-10 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:opacity-90"
          >
            {t("noVehicles.cta")}
          </Link>
        </div>
      ) : (
        <ScanFlow
          vehicles={options}
          defaultVehicleId={defaultVehicleId}
          cancelHref="/dashboard"
        />
      )}
    </div>
  );
}

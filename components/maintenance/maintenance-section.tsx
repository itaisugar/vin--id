import Link from "next/link";
import { getTranslations } from "next-intl/server";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { MaintenanceListItem } from "@/components/maintenance/maintenance-list-item";
import type { MaintenanceLog } from "@/lib/maintenance/types";
import type { MileageUnit } from "@/lib/vehicles/types";

const RECENT_LIMIT = 3;

/** Maintenance summary shown on the vehicle detail page. */
export async function MaintenanceSection({
  vehicleId,
  logs,
  mileageUnit,
}: {
  vehicleId: string;
  logs: MaintenanceLog[];
  mileageUnit: MileageUnit;
}) {
  const t = await getTranslations("maintenance");
  const recent = logs.slice(0, RECENT_LIMIT);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
        <CardTitle>{t("title")}</CardTitle>
        <Link
          href={`/vehicles/${vehicleId}/maintenance/new`}
          className="inline-flex h-9 shrink-0 items-center justify-center rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground transition-colors hover:opacity-90"
        >
          {t("addMaintenance")}
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
              {recent.map((log) => (
                <MaintenanceListItem
                  key={log.id}
                  vehicleId={vehicleId}
                  log={log}
                  mileageUnit={mileageUnit}
                />
              ))}
            </div>
            <Link
              href={`/vehicles/${vehicleId}/maintenance`}
              className="inline-block text-sm font-medium text-primary hover:underline"
            >
              {t("viewAll", { count: logs.length })}
            </Link>
          </>
        )}
      </CardContent>
    </Card>
  );
}

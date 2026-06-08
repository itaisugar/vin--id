"use client";

import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { Card } from "@/components/ui/card";
import { DeleteMaintenanceButton } from "@/components/maintenance/delete-maintenance-button";
import { TrustLabelBadge } from "@/components/maintenance/trust-label-badge";
import type { MaintenanceLog } from "@/lib/maintenance/types";
import type { MileageUnit } from "@/lib/vehicles/types";

export function MaintenanceListItem({
  vehicleId,
  log,
  mileageUnit,
}: {
  vehicleId: string;
  log: MaintenanceLog;
  mileageUnit: MileageUnit;
}) {
  const t = useTranslations("maintenance");
  const tUnits = useTranslations("vehicles");
  const locale = useLocale();

  const date = log.performed_at
    ? new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(
        new Date(log.performed_at),
      )
    : null;

  const cost =
    log.cost != null
      ? new Intl.NumberFormat(locale, {
          style: "currency",
          currency: log.currency || "ILS",
          maximumFractionDigits: 2,
        }).format(log.cost)
      : null;

  const meta = [
    date,
    log.mileage != null
      ? `${log.mileage.toLocaleString(locale)} ${tUnits(`units.${mileageUnit}`)}`
      : null,
    log.service_type,
  ].filter(Boolean);

  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium">
              {meta.length > 0 ? meta.join(" · ") : t("untitled")}
            </span>
            <TrustLabelBadge level={log.trust_label} />
          </div>
          {log.description ? (
            <p className="whitespace-pre-wrap text-sm text-muted-foreground">
              {log.description}
            </p>
          ) : null}
          {cost ? <p className="text-sm font-medium">{cost}</p> : null}
          {log.source_type && log.source_type !== "user" ? (
            <p className="text-xs text-muted-foreground">
              {t("source.label")}: {log.source_type}
            </p>
          ) : null}
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <Link
            href={`/vehicles/${vehicleId}/maintenance/${log.id}/edit`}
            className="inline-flex h-8 items-center justify-center rounded-md px-3 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted"
          >
            {t("edit.action")}
          </Link>
          <DeleteMaintenanceButton vehicleId={vehicleId} logId={log.id} />
        </div>
      </div>
    </Card>
  );
}

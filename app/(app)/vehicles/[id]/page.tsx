import Link from "next/link";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ArchiveVehicleButton } from "@/components/vehicles/archive-vehicle-button";
import { VehicleStatusBadge } from "@/components/vehicles/vehicle-status-badge";
import { MaintenanceSection } from "@/components/maintenance/maintenance-section";
import { IssueSection } from "@/components/issues/issue-section";
import { DocumentSection } from "@/components/documents/document-section";
import { ReminderSection } from "@/components/reminders/reminder-section";
import { PassportSection } from "@/components/passports/passport-section";
import { listMaintenanceLogs } from "@/lib/maintenance/service";
import { listIssues } from "@/lib/issues/service";
import { listDocuments } from "@/lib/documents/service";
import { listReminders } from "@/lib/reminders/service";
import { listPassports } from "@/lib/passports/service";
import { getVehicleById } from "@/lib/vehicles/service";

export default async function VehicleDetailPage({
  params,
}: PageProps<"/vehicles/[id]">) {
  const { id } = await params;
  const t = await getTranslations("vehicles");
  const locale = await getLocale();

  const vehicle = await getVehicleById(id);
  if (!vehicle) notFound();

  const title =
    [vehicle.make, vehicle.model].filter(Boolean).join(" ").trim() ||
    t("untitled");

  const createdAt = new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
  }).format(new Date(vehicle.created_at));

  const [maintenanceLogs, issues, documents, reminders, passports] =
    await Promise.all([
      listMaintenanceLogs(vehicle.id),
      listIssues(vehicle.id),
      listDocuments(vehicle.id),
      listReminders(vehicle.id),
      listPassports(vehicle.id),
    ]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <Link
            href="/vehicles"
            className="text-sm text-muted-foreground hover:underline"
          >
            ← {t("title")}
          </Link>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold">{title}</h1>
            <VehicleStatusBadge status={vehicle.status} />
          </div>
        </div>
        <div className="flex gap-2">
          <Link
            href={`/vehicles/${vehicle.id}/edit`}
            className="inline-flex h-10 items-center justify-center rounded-md border border-border px-4 text-sm font-medium transition-colors hover:bg-muted"
          >
            {t("edit.action")}
          </Link>
          {vehicle.status === "active" ? (
            <ArchiveVehicleButton vehicleId={vehicle.id} />
          ) : null}
        </div>
      </div>

      {/* Details */}
      <Card>
        <CardHeader>
          <CardTitle>{t("detail.title")}</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
            <DetailRow label={t("fields.make")} value={vehicle.make} />
            <DetailRow label={t("fields.model")} value={vehicle.model} />
            <DetailRow
              label={t("fields.year")}
              value={vehicle.year != null ? String(vehicle.year) : null}
            />
            <DetailRow label={t("fields.vin")} value={vehicle.vin} />
            <DetailRow
              label={t("fields.licensePlate")}
              value={vehicle.license_plate}
            />
            <DetailRow
              label={t("fields.mileage")}
              value={
                vehicle.current_mileage != null
                  ? `${vehicle.current_mileage.toLocaleString(locale)} ${t(`units.${vehicle.mileage_unit}`)}`
                  : null
              }
            />
            <DetailRow
              label={t("fields.status")}
              value={t(`status.${vehicle.status}`)}
            />
            <DetailRow label={t("fields.createdAt")} value={createdAt} />
          </dl>
        </CardContent>
      </Card>

      {/* Maintenance (Phase 2C) */}
      <MaintenanceSection
        vehicleId={vehicle.id}
        logs={maintenanceLogs}
        mileageUnit={vehicle.mileage_unit}
      />

      {/* Issues (Phase 2D) */}
      <IssueSection
        vehicleId={vehicle.id}
        issues={issues}
        mileageUnit={vehicle.mileage_unit}
      />

      {/* Documents (Phase 2E) */}
      <DocumentSection vehicleId={vehicle.id} documents={documents} />

      {/* Reminders (Phase 2F) */}
      <ReminderSection
        vehicleId={vehicle.id}
        reminders={reminders}
        currentMileage={vehicle.current_mileage}
        mileageUnit={vehicle.mileage_unit}
      />

      {/* Vehicle Passport (Phase 3A) */}
      <PassportSection vehicleId={vehicle.id} passports={passports} />
    </div>
  );
}

function DetailRow({
  label,
  value,
}: {
  label: string;
  value: string | null;
}) {
  if (!value) return null;
  return (
    <div className="flex flex-col">
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd className="text-sm font-medium">{value}</dd>
    </div>
  );
}

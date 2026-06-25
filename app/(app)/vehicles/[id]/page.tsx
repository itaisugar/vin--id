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
  searchParams,
}: PageProps<"/vehicles/[id]">) {
  const { id } = await params;
  const { accepted } = await searchParams;
  const t = await getTranslations("vehicles");
  const tp = await getTranslations("passports.accept");
  const tdiag = await getTranslations("diagnose");
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
      {/* Passport accepted banner (Phase 3C) */}
      {accepted === "1" ? (
        <div className="rounded-2xl border border-ok/25 bg-ok/10 p-4">
          <p className="text-sm font-semibold text-ok">{tp("bannerTitle")}</p>
          <p className="mt-1 text-xs text-ok/80">{tp("bannerNote")}</p>
        </div>
      ) : null}

      {/* Header — back + actions, then a centered vehicle identity block. */}
      <div className="space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link
            href="/vehicles"
            className="text-sm text-ink-2 transition-colors hover:text-ink"
          >
            <span aria-hidden className="inline-block rtl:rotate-180">←</span>{" "}
            {t("title")}
          </Link>
          <div className="flex flex-wrap gap-2">
            <Link
              href={`/diagnose?vehicle=${vehicle.id}`}
              className="inline-flex h-10 items-center justify-center rounded-xl border border-line bg-surface-2 px-4 text-sm font-medium transition hover:bg-surface active:scale-[.98]"
            >
              {tdiag("vehicleCta")}
            </Link>
            <Link
              href={`/vehicles/${vehicle.id}/edit`}
              className="inline-flex h-10 items-center justify-center rounded-xl border border-line bg-surface-2 px-4 text-sm font-medium transition hover:bg-surface active:scale-[.98]"
            >
              {t("edit.action")}
            </Link>
            {vehicle.status === "active" ? (
              <ArchiveVehicleButton vehicleId={vehicle.id} />
            ) : null}
          </div>
        </div>

        <div className="flex flex-col items-center gap-2 text-center">
          <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1">
            <h1 className="break-words text-2xl font-extrabold tracking-tight">
              {title}
            </h1>
            <VehicleStatusBadge status={vehicle.status} />
          </div>
          {vehicle.license_plate || vehicle.year != null ? (
            <p className="num text-sm text-ink-2">
              {[vehicle.license_plate, vehicle.year].filter(Boolean).join(" · ")}
            </p>
          ) : null}

          {vehicle.current_mileage != null ? (
            <div className="mt-1 inline-flex items-baseline gap-2 rounded-2xl border border-line bg-surface-3 px-6 py-3 glow-accent">
              <span className="num text-3xl font-bold text-accent text-glow-accent">
                {vehicle.current_mileage.toLocaleString(locale)}
              </span>
              <span className="text-xs font-medium uppercase tracking-wide text-ink-3">
                {t(`units.${vehicle.mileage_unit}`)}
              </span>
            </div>
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
              mono
            />
            <DetailRow label={t("fields.vin")} value={vehicle.vin} mono />
            <DetailRow
              label={t("fields.licensePlate")}
              value={vehicle.license_plate}
              mono
            />
            <DetailRow
              label={t("fields.mileage")}
              value={
                vehicle.current_mileage != null
                  ? `${vehicle.current_mileage.toLocaleString(locale)} ${t(`units.${vehicle.mileage_unit}`)}`
                  : null
              }
              mono
            />
            <DetailRow
              label={t("fields.status")}
              value={t(`status.${vehicle.status}`)}
            />
            <DetailRow label={t("fields.createdAt")} value={createdAt} mono />
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
  mono = false,
}: {
  label: string;
  value: string | null;
  mono?: boolean;
}) {
  if (!value) return null;
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-[11px] uppercase tracking-[0.14em] text-ink-3">
        {label}
      </dt>
      <dd
        className={`break-words text-sm font-medium ${mono ? "num text-ink" : "text-ink"}`}
      >
        {value}
      </dd>
    </div>
  );
}

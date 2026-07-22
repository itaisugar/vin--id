import { getLocale, getTranslations } from "next-intl/server";
import { DeadlineBadge } from "@/components/fleet/deadline-badge";
import { OperationalStatusBadge } from "@/components/fleet/operational-status-badge";
import { VehicleStatusControl } from "@/components/fleet/vehicle-status-control";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  classifyDeadline,
  classifyKmDeadline,
  type DeadlineState,
} from "@/lib/fleet/dates";
import type { Vehicle } from "@/lib/vehicles/types";

/**
 * "Fleet information" on the vehicle page: operational status, assigned driver,
 * and the four dated obligations, each flagged when overdue or due soon.
 *
 * `canWrite` toggles the status control vs a read-only badge. Viewers get the
 * badge — the server action and RLS enforce the same rule independently.
 */
export async function FleetInfoCard({
  vehicle,
  canWrite,
}: {
  vehicle: Vehicle;
  canWrite: boolean;
}) {
  const t = await getTranslations("fleet");
  const tv = await getTranslations("vehicles");
  const locale = await getLocale();

  const formatDate = (iso: string | null) =>
    iso
      ? new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(
          new Date(`${iso}T00:00:00Z`),
        )
      : null;

  const serviceDateState = classifyDeadline(vehicle.next_service_date);
  const serviceKmState = classifyKmDeadline(
    vehicle.next_service_km,
    vehicle.current_mileage,
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("infoCard.title")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Operational status — the most important thing on this page. */}
        {canWrite ? (
          <VehicleStatusControl
            vehicleId={vehicle.id}
            status={vehicle.operational_status}
          />
        ) : (
          <div className="space-y-1.5">
            <p className="text-[11px] uppercase tracking-[0.14em] text-ink-3">
              {t("fields.operationalStatus")}
            </p>
            <OperationalStatusBadge status={vehicle.operational_status} />
            <p className="text-xs text-ink-3">{t("viewerReadOnly")}</p>
          </div>
        )}

        <dl className="grid grid-cols-1 gap-x-6 gap-y-3 border-t border-line pt-4 sm:grid-cols-2">
          <Row label={t("fields.vehicleType")} value={vehicle.vehicle_type} />
          <Row
            label={t("fields.assignedDriver")}
            value={vehicle.assigned_driver_name}
          />
          <Row
            label={t("fields.driverPhone")}
            value={vehicle.assigned_driver_phone}
            mono
            href={
              vehicle.assigned_driver_phone
                ? `tel:${vehicle.assigned_driver_phone.replace(/\s/g, "")}`
                : undefined
            }
          />
          <Row
            label={t("fields.currentKm")}
            value={
              vehicle.current_mileage != null
                ? `${vehicle.current_mileage.toLocaleString(locale)} ${tv(`units.${vehicle.mileage_unit}`)}`
                : null
            }
            mono
          />
          <Row
            label={t("fields.nextService")}
            value={formatDate(vehicle.next_service_date)}
            mono
            state={serviceDateState}
          />
          <Row
            label={t("fields.nextServiceKm")}
            value={
              vehicle.next_service_km != null
                ? `${vehicle.next_service_km.toLocaleString(locale)} ${tv(`units.${vehicle.mileage_unit}`)}`
                : null
            }
            mono
            state={serviceKmState}
          />
          <Row
            label={t("fields.testExpiry")}
            value={formatDate(vehicle.test_expiry_date)}
            mono
            state={classifyDeadline(vehicle.test_expiry_date)}
          />
          <Row
            label={t("fields.insuranceExpiry")}
            value={formatDate(vehicle.insurance_expiry_date)}
            mono
            state={classifyDeadline(vehicle.insurance_expiry_date)}
          />
        </dl>

        {/* Timeline placeholder — deliberately holds NO fabricated events. */}
        <p className="border-t border-line pt-4 text-xs text-ink-3">
          {t("infoCard.timelineSoon")}
        </p>
      </CardContent>
    </Card>
  );
}

function Row({
  label,
  value,
  mono = false,
  state,
  href,
}: {
  label: string;
  value: string | null;
  mono?: boolean;
  state?: DeadlineState | null;
  href?: string;
}) {
  if (!value) return null;

  const text = (
    <span className={`break-words text-sm font-medium text-ink ${mono ? "num" : ""}`}>
      {value}
    </span>
  );

  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-[11px] uppercase tracking-[0.14em] text-ink-3">
        {label}
      </dt>
      <dd className="flex flex-wrap items-center gap-2">
        {href ? (
          <a href={href} className="hover:underline">
            {text}
          </a>
        ) : (
          text
        )}
        {state === "overdue" || state === "due_soon" ? (
          <DeadlineBadge state={state} />
        ) : null}
      </dd>
    </div>
  );
}

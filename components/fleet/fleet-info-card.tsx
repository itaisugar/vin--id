import Link from "next/link";
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
import type { OperationalStatus } from "@/lib/fleet/types";
import type { Vehicle } from "@/lib/vehicles/types";

/**
 * "Service & Compliance" on the vehicle page.
 *
 * WHY THIS EXISTS IN THIS SHAPE. Production QA reported that the operational
 * fields could not be found or changed after a vehicle was created. They were in
 * fact fully editable — the vehicle form renders and persists every one of them
 * in edit mode — but nothing on the vehicle page said so: the values sat in an
 * unlabelled information grid with no route to the form. The fix is
 * discoverability, not new plumbing. Each dated obligation is now a LINK into
 * the exact field on the edit form, and the section carries its own Edit action.
 *
 * SOURCE OF TRUTH. `vehicles.next_service_date`, `vehicles.next_service_km` and
 * `vehicles.test_expiry_date` (plus `insurance_expiry_date`) are the only
 * storage for these values. This card reads them and links to the one form that
 * writes them; it introduces no second path and no local state.
 *
 * DRIVER. Deliberately absent. `assigned_driver_name` / `assigned_driver_phone`
 * are free text that grant nothing, and showing them here beside real
 * compliance data is what made a typed name look like an assignment. The
 * authoritative assignment lives in `driver_assignments` and is rendered by
 * <DriverAssignmentCard>, which is the only control that changes access. Any
 * legacy free-text value is surfaced by <LegacyDriverNote> below, explicitly
 * labelled as a contact note.
 *
 * `canWrite` toggles the status control and the edit affordances vs read-only
 * output. Viewers get the read-only form — the server action and RLS enforce
 * the same rule independently.
 */
export async function FleetInfoCard({
  vehicle,
  canWrite,
  effectiveStatus,
}: {
  vehicle: Vehicle;
  canWrite: boolean;
  /** Recomputed status from the fleet row; falls back to the stored column. */
  effectiveStatus?: OperationalStatus;
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

  // Every operational field is edited on the one form that owns it. The hash
  // targets the field so the browser scrolls straight to it.
  const editHref = (field: string) =>
    canWrite ? `/vehicles/${vehicle.id}/edit#${field}` : undefined;

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
        <div className="min-w-0 space-y-0.5">
          <CardTitle>{t("serviceCompliance.title")}</CardTitle>
          <p className="text-xs text-ink-2">{t("serviceCompliance.subtitle")}</p>
        </div>
        {canWrite ? (
          <Link
            href={`/vehicles/${vehicle.id}/edit`}
            className="inline-flex h-9 shrink-0 items-center justify-center rounded-xl border border-line bg-surface-2 px-3 text-sm font-medium transition hover:bg-surface"
          >
            {t("serviceCompliance.edit")}
          </Link>
        ) : null}
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
            <OperationalStatusBadge
              status={effectiveStatus ?? vehicle.operational_status}
            />
            <p className="text-xs text-ink-3">{t("viewerReadOnly")}</p>
          </div>
        )}

        <dl className="grid grid-cols-1 gap-x-6 gap-y-3 border-t border-line pt-4 sm:grid-cols-2">
          <Row label={t("fields.vehicleType")} value={vehicle.vehicle_type} />
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
            emptyLabel={t("serviceCompliance.notSet")}
            mono
            state={serviceDateState}
            href={editHref("next_service_date")}
          />
          <Row
            label={t("fields.nextServiceKm")}
            value={
              vehicle.next_service_km != null
                ? `${vehicle.next_service_km.toLocaleString(locale)} ${tv(`units.${vehicle.mileage_unit}`)}`
                : null
            }
            emptyLabel={t("serviceCompliance.notSet")}
            mono
            state={serviceKmState}
            href={editHref("next_service_km")}
          />
          <Row
            label={t("fields.testExpiry")}
            value={formatDate(vehicle.test_expiry_date)}
            emptyLabel={t("serviceCompliance.notSet")}
            mono
            state={classifyDeadline(vehicle.test_expiry_date)}
            href={editHref("test_expiry_date")}
          />
          <Row
            label={t("fields.insuranceExpiry")}
            value={formatDate(vehicle.insurance_expiry_date)}
            emptyLabel={t("serviceCompliance.notSet")}
            mono
            state={classifyDeadline(vehicle.insurance_expiry_date)}
            href={editHref("insurance_expiry_date")}
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

/**
 * A legacy free-text driver value, shown only when one exists.
 *
 * Rendered separately from the assignment card and explicitly labelled as a
 * contact note so it can never be mistaken for the thing that grants access.
 * Nothing is deleted: the columns still hold whatever was typed, and this is
 * how a fleet manager sees it in order to migrate it to a real assignment.
 */
export async function LegacyDriverNote({ vehicle }: { vehicle: Vehicle }) {
  const t = await getTranslations("fleet");
  const name = vehicle.assigned_driver_name?.trim();
  const phone = vehicle.assigned_driver_phone?.trim();
  if (!name && !phone) return null;

  return (
    <Card>
      <CardHeader className="space-y-0.5">
        <CardTitle className="text-base">{t("driverNote.title")}</CardTitle>
        <p className="text-xs text-ink-2">{t("driverNote.help")}</p>
      </CardHeader>
      <CardContent>
        <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
          <Row label={t("driverNote.name")} value={name ?? null} />
          <Row
            label={t("fields.driverPhone")}
            value={phone ?? null}
            mono
            href={phone ? `tel:${phone.replace(/\s/g, "")}` : undefined}
          />
        </dl>
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
  emptyLabel,
}: {
  label: string;
  value: string | null;
  mono?: boolean;
  state?: DeadlineState | null;
  href?: string;
  /** Shown instead of hiding the row when there is no value yet. */
  emptyLabel?: string;
}) {
  // A field with no value is still worth showing when it is editable: "not set"
  // plus a link is how the user discovers they can set it.
  if (!value && !emptyLabel) return null;

  const text = (
    <span
      className={`break-words text-sm font-medium ${value ? "text-ink" : "text-ink-3"} ${mono && value ? "num" : ""}`}
    >
      {value ?? emptyLabel}
    </span>
  );

  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-[11px] uppercase tracking-[0.14em] text-ink-3">
        {label}
      </dt>
      <dd className="flex flex-wrap items-center gap-2">
        {href ? (
          <Link href={href} className="underline-offset-2 hover:underline">
            {text}
          </Link>
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

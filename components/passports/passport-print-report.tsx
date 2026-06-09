import { getLocale, getTranslations } from "next-intl/server";
import { ConfidenceScore } from "@/components/passports/confidence-score";
import { PassportStatusBadge } from "@/components/passports/passport-status-badge";
import { PassportSummaryView } from "@/components/passports/passport-summary";
import { PassportTimeline } from "@/components/passports/passport-timeline";
import {
  effectiveStatus,
  type PassportSummary,
  type VehiclePassport,
} from "@/lib/passports/types";

function safeSummary(value: unknown): PassportSummary {
  const v = (value ?? {}) as Partial<PassportSummary>;
  return {
    strengths: v.strengths ?? [],
    attention_points: v.attention_points ?? [],
    recommended_checks: v.recommended_checks ?? [],
    missing_or_not_shared: v.missing_or_not_shared ?? [],
    generated: "deterministic",
  };
}

/**
 * Print-friendly Vehicle Passport report, built from the snapshot ONLY.
 * Never includes storage paths, signed/raw file URLs, or the share token — the
 * raw token isn't stored (only its hash), so only the hash + Passport ID are
 * shown here.
 * TODO(qr): include a QR code only at creation/export, when the raw share link
 * is briefly available (no QR library is bundled and no raw token is stored).
 */
export async function PassportPrintReport({
  passport,
}: {
  passport: VehiclePassport;
}) {
  const t = await getTranslations("passports");
  const tv = await getTranslations("vehicles");
  const tc = await getTranslations("common");
  const locale = await getLocale();

  const status = effectiveStatus(passport);
  const fmtDate = (d: string | null) =>
    d
      ? new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(
          new Date(d),
        )
      : "—";

  const snapshot = passport.snapshot;
  const vehicle = snapshot.vehicle;
  const vehicleTitle =
    [vehicle.make, vehicle.model].filter(Boolean).join(" ").trim() ||
    tv("untitled");
  const summary = safeSummary(passport.ai_summary);

  return (
    <div className="mx-auto max-w-3xl space-y-6 rounded-lg border border-border bg-background p-6 text-foreground print:max-w-none print:rounded-none print:border-0 print:p-0">
      {/* Branding header */}
      <header className="space-y-2 border-b border-border pb-4">
        <div className="flex items-center justify-between">
          <span className="text-lg font-bold">{tc("appName")}</span>
          <PassportStatusBadge status={status} />
        </div>
        <div>
          <h1 className="text-2xl font-bold">{t("title")}</h1>
          <p className="text-xs text-muted-foreground">{t("print.generated")}</p>
        </div>
        {vehicleTitle ? (
          <p className="text-sm font-medium">{vehicleTitle}</p>
        ) : null}
      </header>

      {/* Meta */}
      <section className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
        <Row label={t("detail.created")} value={fmtDate(passport.issued_at ?? passport.created_at)} />
        <Row label={t("detail.expires")} value={fmtDate(passport.expires_at)} />
        <Row label={t("detail.status")} value={t(`statuses.${status}`)} />
        <Row label={t("detail.version")} value={String(passport.version)} />
        <Row label={t("print.passportId")} value={passport.id} mono />
      </section>

      {/* Vehicle summary */}
      <section className="space-y-2">
        <h2 className="text-sm font-semibold">{t("public.vehicleSummary")}</h2>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
          <Row label={tv("fields.make")} value={vehicle.make} />
          <Row label={tv("fields.model")} value={vehicle.model} />
          <Row
            label={tv("fields.year")}
            value={vehicle.year != null ? String(vehicle.year) : null}
          />
          <Row label={tv("fields.vin")} value={vehicle.vin} />
          <Row label={tv("fields.licensePlate")} value={vehicle.license_plate} />
          <Row
            label={tv("fields.mileage")}
            value={
              vehicle.current_mileage != null
                ? `${vehicle.current_mileage.toLocaleString(locale)} ${tv(`units.${vehicle.mileage_unit}`)}`
                : null
            }
          />
        </dl>
      </section>

      {/* Record Confidence */}
      <section className="rounded-md border border-border p-4">
        <ConfidenceScore score={passport.record_confidence_score} />
      </section>

      {/* Summary */}
      <section className="space-y-2">
        <h2 className="text-sm font-semibold">{t("summary.title")}</h2>
        <PassportSummaryView summary={summary} />
      </section>

      {/* Timeline / records (documents are metadata only) */}
      <section className="space-y-2">
        <h2 className="text-sm font-semibold">{t("timeline.title")}</h2>
        <PassportTimeline snapshot={snapshot} />
      </section>

      {/* Verification */}
      <section className="space-y-2">
        <h2 className="text-sm font-semibold">{t("verification.title")}</h2>
        <p className="text-sm text-muted-foreground">{t("verification.text")}</p>
        <p className="text-xs font-medium text-muted-foreground">
          {t("detail.hashLabel")}
        </p>
        <p className="break-all rounded-md bg-muted p-2 font-mono text-xs">
          {passport.snapshot_hash ?? "—"}
        </p>
        <p className="text-xs text-muted-foreground">{t("print.shareNote")}</p>
      </section>

      {/* Disclaimers */}
      <section className="space-y-1 rounded-md border border-border p-3 text-xs text-muted-foreground">
        <p>{t("public.disclaimers.provided")}</p>
        <p>{t("public.disclaimers.notOwnership")}</p>
        <p>{t("public.disclaimers.notCertification")}</p>
        <p>{t("confidenceHelp")}</p>
        <p>{t("public.disclaimers.inspect")}</p>
      </section>
    </div>
  );
}

function Row({
  label,
  value,
  mono,
}: {
  label: string;
  value: string | null;
  mono?: boolean;
}) {
  if (!value) return null;
  return (
    <div className="flex flex-col">
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd className={mono ? "break-all font-mono text-xs" : "text-sm font-medium"}>
        {value}
      </dd>
    </div>
  );
}

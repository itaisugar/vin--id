import { getLocale, getTranslations } from "next-intl/server";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ConfidenceScore } from "@/components/passports/confidence-score";
import { PassportStatusBadge } from "@/components/passports/passport-status-badge";
import { PassportSummaryView } from "@/components/passports/passport-summary";
import { PassportTimeline } from "@/components/passports/passport-timeline";
import type { PublicPassportView } from "@/lib/passports/public";
import {
  effectiveStatus,
  type PassportSummary,
  type SnapshotMissing,
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

export async function PublicPassportReport({
  view,
}: {
  view: PublicPassportView;
}) {
  const t = await getTranslations("passports");
  const tv = await getTranslations("vehicles");
  const locale = await getLocale();

  const status = effectiveStatus(view);
  const fmt = (d: string | null) =>
    d
      ? new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(
          new Date(d),
        )
      : "—";

  const { snapshot } = view;
  const vehicle = snapshot.vehicle;
  const vehicleTitle =
    [vehicle.make, vehicle.model].filter(Boolean).join(" ").trim();
  const summary = safeSummary(view.ai_summary);

  const missing: SnapshotMissing = snapshot.missing_or_not_shared;
  const missingLines: string[] = [];
  if (missing.issue_history_excluded) {
    missingLines.push(t("public.missing.issuesExcluded"));
  }
  if (missing.documents_excluded_count > 0) {
    missingLines.push(
      t("public.missing.documentsExcluded", {
        count: missing.documents_excluded_count,
      }),
    );
  }
  if (missing.personal_documents_excluded_count > 0) {
    missingLines.push(
      t("public.missing.personalExcluded", {
        count: missing.personal_documents_excluded_count,
      }),
    );
  }
  if (missing.no_document_backed_records) {
    missingLines.push(t("public.missing.noDocumentBacked"));
  }
  if (missing.no_recent_service) {
    missingLines.push(t("public.missing.noRecentService"));
  }

  return (
    <div className="space-y-6">
      {/* A. Header */}
      <Card>
        <CardHeader className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="text-xl">{t("title")}</CardTitle>
            <div className="flex items-center gap-2">
              <PassportStatusBadge status={status} />
              <Badge tone="success">{t("public.verified")}</Badge>
            </div>
          </div>
          {vehicleTitle ? (
            <p className="text-sm font-medium">{vehicleTitle}</p>
          ) : null}
          <p className="text-xs text-muted-foreground">
            {t("detail.created")}: {fmt(view.issued_at)} · {t("detail.expires")}:{" "}
            {fmt(view.expires_at)}
          </p>
        </CardHeader>
      </Card>

      {/* B. Vehicle summary */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("public.vehicleSummary")}</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
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
        </CardContent>
      </Card>

      {/* C. Record Confidence */}
      <Card>
        <CardContent className="p-4">
          <ConfidenceScore score={view.record_confidence_score} />
        </CardContent>
      </Card>

      {/* D. Verification / tamper-evident */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("verification.title")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <p className="text-sm text-muted-foreground">{t("verification.text")}</p>
          <p className="text-xs font-medium text-muted-foreground">
            {t("detail.hashLabel")}
          </p>
          <p
            className="break-all rounded-md bg-muted p-2 font-mono text-xs"
            title={view.snapshot_hash ?? ""}
          >
            {view.snapshot_hash ?? "—"}
          </p>
        </CardContent>
      </Card>

      {/* E. Summary */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("summary.title")}</CardTitle>
        </CardHeader>
        <CardContent>
          <PassportSummaryView summary={summary} />
        </CardContent>
      </Card>

      {/* F. Timeline / records */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("timeline.title")}</CardTitle>
        </CardHeader>
        <CardContent>
          <PassportTimeline snapshot={snapshot} />
        </CardContent>
      </Card>

      {/* G. Missing / not shared */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("public.missingTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          {missingLines.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {t("public.missing.none")}
            </p>
          ) : (
            <ul className="list-disc space-y-1 ps-5 text-sm text-muted-foreground">
              {missingLines.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* H. Disclaimers */}
      <Card>
        <CardContent className="space-y-1 p-4 text-xs text-muted-foreground">
          <p>{t("public.disclaimers.provided")}</p>
          <p>{t("public.disclaimers.notOwnership")}</p>
          <p>{t("public.disclaimers.notCertification")}</p>
          <p>{t("public.disclaimers.inspect")}</p>
        </CardContent>
      </Card>

      {/* I. Accept CTA placeholder (not implemented) */}
      <Card>
        <CardContent className="flex flex-col items-center gap-2 p-6 text-center">
          <button
            type="button"
            disabled
            className="inline-flex h-10 cursor-not-allowed items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground opacity-60"
          >
            {t("public.acceptCta")}
          </button>
          <p className="text-xs text-muted-foreground">{t("public.acceptHint")}</p>
        </CardContent>
      </Card>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string | null }) {
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

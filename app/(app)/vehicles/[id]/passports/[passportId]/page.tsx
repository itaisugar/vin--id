import Link from "next/link";
import { notFound } from "next/navigation";
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
import { RevokePassportButton } from "@/components/passports/revoke-passport-button";
import { getPassport } from "@/lib/passports/service";
import {
  effectiveStatus,
  type PassportScope,
  type PassportSummary,
} from "@/lib/passports/types";
import { getVehicleById } from "@/lib/vehicles/service";

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

export default async function PassportDetailPage({
  params,
}: PageProps<"/vehicles/[id]/passports/[passportId]">) {
  const { id, passportId } = await params;
  const t = await getTranslations("passports");
  const locale = await getLocale();

  const vehicle = await getVehicleById(id);
  if (!vehicle) notFound();

  const passport = await getPassport(id, passportId);
  if (!passport) notFound();

  const status = effectiveStatus(passport);
  const fmt = (d: string | null) =>
    d
      ? new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(
          new Date(d),
        )
      : "—";

  const snapshot = passport.snapshot;
  const summary = safeSummary(passport.ai_summary);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <Link
            href={`/vehicles/${id}`}
            className="text-sm text-muted-foreground hover:underline"
          >
            ← {t("title")}
          </Link>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold">{t("detail.title")}</h1>
            <PassportStatusBadge status={status} />
          </div>
        </div>
        {status === "active" ? (
          <RevokePassportButton vehicleId={id} passportId={passportId} />
        ) : null}
      </div>

      {/* Meta + confidence */}
      <Card>
        <CardContent className="grid gap-6 p-4 sm:grid-cols-2">
          <dl className="space-y-2 text-sm">
            <Meta label={t("detail.status")} value={t(`statuses.${status}`)} />
            <Meta label={t("detail.created")} value={fmt(passport.created_at)} />
            <Meta label={t("detail.expires")} value={fmt(passport.expires_at)} />
            <Meta label={t("detail.version")} value={String(passport.version)} />
          </dl>
          <ConfidenceScore score={passport.record_confidence_score} />
        </CardContent>
      </Card>

      {/* Share link (token shown once at creation; not re-exposed here) */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("share.title")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <p className="text-sm text-muted-foreground">
            {status === "active"
              ? t("share.activeNote", { date: fmt(passport.expires_at) })
              : t("share.inactiveNote")}
          </p>
          {status === "active" ? (
            <p className="text-xs text-muted-foreground">{t("share.terms")}</p>
          ) : null}
          <p className="text-xs text-muted-foreground">{t("share.tokenNote")}</p>
          {/* TODO(public-preview): build public /p/[token] page. */}
          {/* TODO(regenerate-link): allow re-issuing a share token. */}
        </CardContent>
      </Card>

      {/* Included scopes */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("detail.includedScopes")}</CardTitle>
        </CardHeader>
        <CardContent>
          {snapshot.included_scopes.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("detail.noScopes")}</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {snapshot.included_scopes.map((scope: PassportScope) => (
                <Badge key={scope} tone="neutral">
                  {t(`scopes.${scope}`)}
                </Badge>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Summary */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("summary.title")}</CardTitle>
        </CardHeader>
        <CardContent>
          <PassportSummaryView summary={summary} />
        </CardContent>
      </Card>

      {/* Timeline */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("timeline.title")}</CardTitle>
        </CardHeader>
        <CardContent>
          <PassportTimeline snapshot={snapshot} />
        </CardContent>
      </Card>

      {/* Verification + disclaimers */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("verification.title")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">{t("verification.text")}</p>
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground">
              {t("detail.hashLabel")}
            </p>
            <p
              className="break-all rounded-md bg-muted p-2 font-mono text-xs"
              title={passport.snapshot_hash ?? ""}
            >
              {passport.snapshot_hash ?? "—"}
            </p>
          </div>
          <div className="space-y-1 rounded-md border border-border p-3 text-xs text-muted-foreground">
            <p>{t("disclaimers.notOwnership")}</p>
            <p>{t("disclaimers.notCertification")}</p>
            <p>{t("confidenceHelp")}</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}

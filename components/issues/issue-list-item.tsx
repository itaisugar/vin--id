"use client";

import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { Card } from "@/components/ui/card";
import { DeleteIssueButton } from "@/components/issues/delete-issue-button";
import { ResolveIssueButton } from "@/components/issues/resolve-issue-button";
import { SeverityBadge } from "@/components/issues/severity-badge";
import { IssueStatusBadge } from "@/components/issues/status-badge";
import { TrustLabelBadge } from "@/components/issues/trust-label-badge";
import type { IssueLog } from "@/lib/issues/types";
import type { MileageUnit } from "@/lib/vehicles/types";

export function IssueListItem({
  vehicleId,
  issue,
  mileageUnit,
}: {
  vehicleId: string;
  issue: IssueLog;
  mileageUnit: MileageUnit;
}) {
  const t = useTranslations("issues");
  const tUnits = useTranslations("vehicles");
  const locale = useLocale();

  const date = issue.reported_at
    ? new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(
        new Date(issue.reported_at),
      )
    : null;

  const meta = [
    date,
    issue.mileage != null
      ? `${issue.mileage.toLocaleString(locale)} ${tUnits(`units.${mileageUnit}`)}`
      : null,
  ].filter(Boolean);

  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <IssueStatusBadge status={issue.status} />
            <SeverityBadge severity={issue.severity} />
            <TrustLabelBadge level={issue.trust_label} />
          </div>
          {meta.length > 0 ? (
            <p className="text-xs text-muted-foreground">{meta.join(" · ")}</p>
          ) : null}
          {issue.title ? (
            <p className="whitespace-pre-wrap text-sm">{issue.title}</p>
          ) : null}
          {issue.status === "resolved" && issue.resolution_notes ? (
            <p className="whitespace-pre-wrap text-sm text-muted-foreground">
              <span className="font-medium">{t("resolutionPrefix")}: </span>
              {issue.resolution_notes}
            </p>
          ) : null}
          {issue.source_type && issue.source_type !== "user" ? (
            <p className="text-xs text-muted-foreground">
              {t("source.label")}: {issue.source_type}
            </p>
          ) : null}
        </div>

        <div className="flex shrink-0 flex-col items-end gap-1">
          {issue.status !== "resolved" ? (
            <ResolveIssueButton vehicleId={vehicleId} issueId={issue.id} />
          ) : null}
          <div className="flex items-center gap-1">
            <Link
              href={`/vehicles/${vehicleId}/issues/${issue.id}/edit`}
              className="inline-flex h-8 items-center justify-center rounded-md px-3 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted"
            >
              {t("edit.action")}
            </Link>
            <DeleteIssueButton vehicleId={vehicleId} issueId={issue.id} />
          </div>
        </div>
      </div>
    </Card>
  );
}

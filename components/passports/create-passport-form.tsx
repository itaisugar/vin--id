"use client";

import * as React from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { createPassportAction } from "@/app/(app)/vehicles/[id]/passports/actions";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { ShareUrl } from "@/components/passports/share-url";
import { WebShareButton } from "@/components/passports/web-share-button";
import type { PassportCounts } from "@/lib/passports/service";
import { cn } from "@/lib/utils";

interface Options {
  includeMaintenance: boolean;
  includeIssues: boolean;
  includeDocuments: boolean;
  includeReminders: boolean;
  includePersonalDocs: boolean;
}

export function CreatePassportForm({
  vehicleId,
  counts,
  cancelHref,
}: {
  vehicleId: string;
  counts: PassportCounts;
  cancelHref: string;
}) {
  const t = useTranslations("passports");
  const [opts, setOpts] = React.useState<Options>({
    includeMaintenance: true,
    includeIssues: true,
    includeDocuments: true,
    includeReminders: true,
    includePersonalDocs: false,
  });
  const [error, setError] = React.useState<string | null>(null);
  const [success, setSuccess] = React.useState<{
    shareUrl: string | null;
    passportId: string;
  } | null>(null);
  const [isPending, startTransition] = React.useTransition();

  const set = (key: keyof Options) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setOpts((o) => ({ ...o, [key]: e.target.checked }));

  // Derived preview counts.
  const docsIncluded = opts.includeDocuments
    ? opts.includePersonalDocs
      ? counts.documentsShareable
      : counts.documentsShareable - counts.documentsPersonalShareable
    : 0;
  const preview = {
    maintenance: opts.includeMaintenance ? counts.maintenance : 0,
    issues: opts.includeIssues ? counts.issues : 0,
    documents: docsIncluded,
    reminders: opts.includeReminders ? counts.reminders : 0,
  };

  const onConfirm = () => {
    setError(null);
    startTransition(async () => {
      const result = await createPassportAction(vehicleId, opts);
      if (result?.error) {
        setError(result.error);
        return;
      }
      // Enter the success state whenever the passport was created, even if the
      // share URL couldn't be generated (misconfigured app URL) — the success
      // card explains that case instead of showing a broken link.
      if (result?.passportId) {
        setSuccess({
          shareUrl: result.shareUrl ?? null,
          passportId: result.passportId,
        });
      }
    });
  };

  if (success) {
    return (
      <div className="space-y-5">
        <Card>
          <CardHeader>
            <CardTitle>{t("create.successTitle")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              {t("create.successBody")}
            </p>
            {success.shareUrl ? (
              <div className="space-y-2">
                <p className="text-sm font-medium">{t("share.title")}</p>
                <ShareUrl url={success.shareUrl} />
                <p className="rounded-md bg-warn/12 p-2 text-xs font-medium text-warn">
                  ⚠️ {t("share.copyOnce")}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t("share.terms")}
                </p>
              </div>
            ) : (
              <p
                role="alert"
                className="rounded-md bg-warn/12 p-3 text-sm font-medium text-warn"
              >
                ⚠️ {t("share.linkUnavailable")}
              </p>
            )}
            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
              {success.shareUrl ? (
                <>
                  <WebShareButton
                    url={success.shareUrl}
                    title={t("share.shareTitle")}
                    text={t("share.shareText")}
                  />
                  <a
                    href={success.shareUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex h-10 w-full items-center justify-center rounded-md border border-border px-4 text-sm font-medium transition-colors hover:bg-muted sm:w-auto"
                  >
                    {t("create.openPreview")}
                  </a>
                </>
              ) : null}
              <Link
                href={`/vehicles/${vehicleId}/passports/${success.passportId}/print`}
                className="inline-flex h-10 w-full items-center justify-center rounded-md border border-border px-4 text-sm font-medium transition-colors hover:bg-muted sm:w-auto"
              >
                {t("print.exportCta")}
              </Link>
              <Link
                href={`/vehicles/${vehicleId}/passports/${success.passportId}`}
                className="inline-flex h-10 w-full items-center justify-center rounded-md border border-border px-4 text-sm font-medium transition-colors hover:bg-muted sm:w-auto"
              >
                {t("create.openPassport")}
              </Link>
            </div>
          </CardContent>
        </Card>

        {/* Next steps */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("nextSteps.title")}</CardTitle>
          </CardHeader>
          <CardContent>
            <ol className="list-decimal space-y-2 ps-5 text-sm text-muted-foreground">
              <li>{t("nextSteps.copyLink")}</li>
              <li>{t("nextSteps.buyerPreview")}</li>
              <li>{t("nextSteps.oneTimeAccept")}</li>
              <li>{t("nextSteps.revokeBefore")}</li>
              <li>{t("nextSteps.printCopy")}</li>
            </ol>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Scope chooser */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("create.chooseScopes")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <ScopeRow
            label={t("scopes.maintenance")}
            count={counts.maintenance}
            checked={opts.includeMaintenance}
            onChange={set("includeMaintenance")}
          />
          <ScopeRow
            label={t("scopes.issues")}
            count={counts.issues}
            checked={opts.includeIssues}
            onChange={set("includeIssues")}
          />
          <ScopeRow
            label={t("scopes.documents")}
            count={counts.documentsShareable}
            checked={opts.includeDocuments}
            onChange={set("includeDocuments")}
          />
          <ScopeRow
            label={t("scopes.reminders")}
            count={counts.reminders}
            checked={opts.includeReminders}
            onChange={set("includeReminders")}
          />

          {opts.includeDocuments && counts.documentsPersonalShareable > 0 ? (
            <label className="flex items-center gap-2 rounded-md bg-warn/12 p-2 text-xs text-warn">
              <Checkbox
                checked={opts.includePersonalDocs}
                onChange={set("includePersonalDocs")}
              />
              {t("create.includePersonalDocs", {
                count: counts.documentsPersonalShareable,
              })}
            </label>
          ) : null}
        </CardContent>
      </Card>

      {/* Preview */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("create.previewTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <ul className="grid grid-cols-2 gap-2 text-sm">
            <PreviewStat label={t("scopes.maintenance")} value={preview.maintenance} />
            <PreviewStat label={t("scopes.issues")} value={preview.issues} />
            <PreviewStat label={t("scopes.documents")} value={preview.documents} />
            <PreviewStat label={t("scopes.reminders")} value={preview.reminders} />
          </ul>

          <div className="space-y-1.5 text-xs text-muted-foreground">
            {counts.documentsNonShareable > 0 ? (
              <Warning>
                {t("warnings.nonShareableExcluded", {
                  count: counts.documentsNonShareable,
                })}
              </Warning>
            ) : null}
            {counts.documentsPersonalShareable > 0 && !opts.includePersonalDocs ? (
              <Warning>
                {t("warnings.personalExcluded", {
                  count: counts.documentsPersonalShareable,
                })}
              </Warning>
            ) : null}
            <Warning>{t("warnings.notOwnershipDocument")}</Warning>
            <Warning>{t("warnings.notConditionScore")}</Warning>
          </div>
        </CardContent>
      </Card>

      {error ? (
        <p role="alert" className="text-sm text-danger">
          {t(`errors.${error}`)}
        </p>
      ) : null}

      <div className="flex gap-2">
        <Button type="button" onClick={onConfirm} disabled={isPending}>
          {isPending ? t("create.creating") : t("create.confirm")}
        </Button>
        <Link
          href={cancelHref}
          className={cn(
            "inline-flex h-10 items-center justify-center rounded-md border border-border px-4 text-sm font-medium transition-colors hover:bg-muted",
          )}
        >
          {t("create.cancel")}
        </Link>
      </div>
    </div>
  );
}

function ScopeRow({
  label,
  count,
  checked,
  onChange,
}: {
  label: string;
  count: number;
  checked: boolean;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-3">
      <span className="flex items-center gap-2 text-sm font-medium">
        <Checkbox checked={checked} onChange={onChange} />
        {label}
      </span>
      <span className="text-xs text-muted-foreground">{count}</span>
    </label>
  );
}

function PreviewStat({ label, value }: { label: string; value: number }) {
  return (
    <li className="flex items-center justify-between rounded-md border border-border px-3 py-2">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-semibold tabular-nums">{value}</span>
    </li>
  );
}

function Warning({ children }: { children: React.ReactNode }) {
  return <p>⚠️ {children}</p>;
}

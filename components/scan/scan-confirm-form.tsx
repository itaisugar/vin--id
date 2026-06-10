"use client";

import * as React from "react";
import Link from "next/link";
import {
  useForm,
  useWatch,
  type SubmitHandler,
  type UseFormRegisterReturn,
} from "react-hook-form";
import { useTranslations } from "next-intl";
import { createRecordFromScanAction } from "@/app/(app)/scan/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  confidenceBucket,
  CURRENCIES,
  extractionToScanForm,
  ISSUE_SEVERITIES,
  ISSUE_STATUSES,
  SCAN_RECORD_TYPES,
  type ScanConfirmFormValues,
  type ScanExtraction,
} from "@/lib/documents/scan/types";

const CONF_TONE = {
  low: "muted",
  medium: "neutral",
  high: "success",
} as const;

/**
 * Pre-filled, fully-editable confirmation. The record is created via the
 * existing maintenance/issue server action (same Zod validation, same
 * mileage-bump and trust-label handling) only when the user confirms.
 */
export function ScanConfirmForm({
  vehicleId,
  extraction,
  engine,
  failed,
  cancelHref,
  onBack,
}: {
  vehicleId: string;
  extraction: ScanExtraction;
  engine: "mock" | "anthropic" | "none";
  failed: boolean;
  cancelHref: string;
  onBack: () => void;
}) {
  const t = useTranslations("scan");
  // Reuse the existing issue severity/status labels rather than duplicating them.
  const ti = useTranslations("issues");
  const [serverError, setServerError] = React.useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = React.useState<
    Record<string, string>
  >({});

  const {
    register,
    handleSubmit,
    control,
    formState: { isSubmitting },
  } = useForm<ScanConfirmFormValues>({
    defaultValues: extractionToScanForm(extraction),
  });

  const recordType = useWatch({
    control,
    name: "record_type",
    defaultValue: extractionToScanForm(extraction).record_type,
  });

  const onSubmit: SubmitHandler<ScanConfirmFormValues> = async (values) => {
    setServerError(null);
    setFieldErrors({});
    const res = await createRecordFromScanAction(
      vehicleId,
      values.record_type,
      values,
    );
    if (res?.fieldErrors) {
      setFieldErrors(res.fieldErrors as Record<string, string>);
    }
    if (res?.error) setServerError(res.error);
  };

  const fieldErr = (name: string) =>
    fieldErrors[name] ? t(`errors.${fieldErrors[name]}`) : null;

  const showConfidence = engine !== "none" && extraction.confidence != null;
  const bucket = confidenceBucket(extraction.confidence);

  return (
    <Card className="border-primary/40">
      <CardHeader className="space-y-2">
        <CardTitle className="text-base">{t("review.title")}</CardTitle>
        <p className="text-xs text-muted-foreground">{t("review.help")}</p>

        {failed ? (
          <p className="rounded-md bg-amber-500/15 px-2 py-1 text-xs text-amber-700 dark:text-amber-400">
            {t("review.failedNotice")}
          </p>
        ) : engine === "mock" ? (
          <p className="rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground">
            {t("review.mockNotice")}
          </p>
        ) : engine === "anthropic" ? (
          <p className="rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground">
            {t("review.aiNotice")}
          </p>
        ) : null}

        {showConfidence ? (
          <Badge tone={CONF_TONE[bucket]}>
            {t(`confidence.${bucket}`)}
          </Badge>
        ) : null}
      </CardHeader>

      <CardContent>
        <form
          onSubmit={handleSubmit(onSubmit)}
          className="space-y-4"
          noValidate
        >
          {/* Record type */}
          <div className="space-y-1.5">
            <Label htmlFor="record_type">{t("fields.recordType")}</Label>
            <Select id="record_type" {...register("record_type")}>
              {SCAN_RECORD_TYPES.map((rt) => (
                <option key={rt} value={rt}>
                  {t(`recordTypes.${rt}`)}
                </option>
              ))}
            </Select>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              name="date"
              label={t("fields.date")}
              type="date"
              error={fieldErr("date")}
              registration={register("date")}
            />
            <Field
              name="mileage"
              label={t("fields.mileage")}
              type="number"
              inputMode="numeric"
              error={fieldErr("mileage")}
              registration={register("mileage")}
            />
          </div>

          {/* Description / symptoms (label depends on record type) */}
          <div className="space-y-1.5">
            <Label htmlFor="description">
              {recordType === "issue"
                ? t("fields.symptoms")
                : t("fields.description")}
            </Label>
            <Textarea id="description" rows={3} {...register("description")} />
            {fieldErr("description") ? (
              <p className="text-sm text-red-600">{fieldErr("description")}</p>
            ) : null}
          </div>

          {recordType === "maintenance" ? (
            <>
              <Field
                name="category"
                label={t("fields.category")}
                error={fieldErr("category")}
                registration={register("category")}
              />
              <div className="grid grid-cols-[1fr_auto] gap-2">
                <Field
                  name="cost"
                  label={t("fields.cost")}
                  type="number"
                  inputMode="decimal"
                  step="0.01"
                  error={fieldErr("cost")}
                  registration={register("cost")}
                />
                <div className="space-y-1.5">
                  <Label htmlFor="currency">{t("fields.currency")}</Label>
                  <Select id="currency" {...register("currency")}>
                    {CURRENCIES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </Select>
                </div>
              </div>
            </>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="severity">{t("fields.severity")}</Label>
                <Select id="severity" {...register("severity")}>
                  {ISSUE_SEVERITIES.map((s) => (
                    <option key={s} value={s}>
                      {ti(`severities.${s}`)}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="status">{t("fields.status")}</Label>
                <Select id="status" {...register("status")}>
                  {ISSUE_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {ti(`statuses.${s}`)}
                    </option>
                  ))}
                </Select>
              </div>
            </div>
          )}

          <p className="text-xs text-muted-foreground">{t("review.trustNote")}</p>

          {serverError ? (
            <p role="alert" className="text-sm text-red-600">
              {t(`errors.${serverError}`)}
            </p>
          ) : null}

          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? t("actions.saving") : t("actions.confirm")}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={onBack}
              disabled={isSubmitting}
            >
              {t("actions.back")}
            </Button>
            <Link
              href={cancelHref}
              className={cn(
                "inline-flex h-10 items-center justify-center rounded-md border border-border px-4 text-sm font-medium transition-colors hover:bg-muted",
              )}
            >
              {t("actions.cancel")}
            </Link>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function Field({
  name,
  label,
  error,
  registration,
  ...props
}: Omit<React.InputHTMLAttributes<HTMLInputElement>, "name"> & {
  name: string;
  label: string;
  error?: string | null;
  registration: UseFormRegisterReturn;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={name}>{label}</Label>
      <Input
        id={name}
        aria-invalid={Boolean(error)}
        {...registration}
        {...props}
      />
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
    </div>
  );
}

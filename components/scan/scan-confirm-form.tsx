"use client";

import * as React from "react";
import Link from "next/link";
import {
  useForm,
  useWatch,
  type SubmitHandler,
  type UseFormRegister,
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
  SCAN_FORM_CATEGORIES,
  type ScanConfirmFormValues,
  type ScanExtraction,
} from "@/lib/documents/scan/types";

const CONF_TONE = {
  low: "muted",
  medium: "neutral",
  high: "success",
} as const;

/**
 * Pre-filled, fully-editable confirmation. The form shows ONLY the detected
 * category's fields; correcting the category swaps the visible field set. The
 * record is created (via the matching server flow) only when the user confirms.
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

  const defaults = React.useMemo(
    () => extractionToScanForm(extraction),
    [extraction],
  );

  const {
    register,
    handleSubmit,
    control,
    formState: { isSubmitting },
  } = useForm<ScanConfirmFormValues>({ defaultValues: defaults });

  const category = useWatch({
    control,
    name: "category",
    defaultValue: defaults.category,
  });

  const onSubmit: SubmitHandler<ScanConfirmFormValues> = async (values) => {
    setServerError(null);
    setFieldErrors({});
    const res = await createRecordFromScanAction(
      vehicleId,
      values.category,
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
  const undetected = extraction.document_category === "unknown";

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

        {!failed && undetected ? (
          <p className="rounded-md bg-amber-500/15 px-2 py-1 text-xs text-amber-700 dark:text-amber-400">
            {t("review.unknownNotice")}
          </p>
        ) : null}

        {showConfidence ? (
          <Badge tone={CONF_TONE[bucket]}>{t(`confidence.${bucket}`)}</Badge>
        ) : null}
      </CardHeader>

      <CardContent>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
          {/* Category — correcting this swaps the visible field set. */}
          <div className="space-y-1.5">
            <Label htmlFor="category">{t("fields.category_label")}</Label>
            <Select id="category" {...register("category")}>
              {SCAN_FORM_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {t(`categories.${c}`)}
                </option>
              ))}
            </Select>
          </div>

          {/* ---- maintenance ---- */}
          {category === "maintenance" ? (
            <>
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
              <Field
                name="service_type"
                label={t("fields.serviceType")}
                error={fieldErr("category")}
                registration={register("service_type")}
              />
              <Field
                name="garage_name"
                label={t("fields.garageName")}
                registration={register("garage_name")}
              />
              <div className="space-y-1.5">
                <Label htmlFor="description">{t("fields.description")}</Label>
                <Textarea id="description" rows={3} {...register("description")} />
                {fieldErr("description") ? (
                  <p className="text-sm text-red-600">
                    {fieldErr("description")}
                  </p>
                ) : null}
              </div>
              <CostCurrency
                t={t}
                error={fieldErr("cost")}
                costReg={register("cost")}
                currencyReg={register("currency")}
              />
            </>
          ) : null}

          {/* ---- issue ---- */}
          {category === "issue" ? (
            <>
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
              <div className="space-y-1.5">
                <Label htmlFor="description">{t("fields.symptoms")}</Label>
                <Textarea id="description" rows={3} {...register("description")} />
                {fieldErr("description") ? (
                  <p className="text-sm text-red-600">
                    {fieldErr("description")}
                  </p>
                ) : null}
              </div>
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
            </>
          ) : null}

          {/* ---- insurance ---- */}
          {category === "insurance" ? (
            <>
              <Field
                name="insurer_name"
                label={t("fields.insurerName")}
                error={fieldErr("insurer_name")}
                registration={register("insurer_name")}
              />
              <Field
                name="insurance_type"
                label={t("fields.insuranceType")}
                error={fieldErr("insurance_type")}
                registration={register("insurance_type")}
              />
              <StartEndDates t={t} fieldErr={fieldErr} register={register} />
              <CostCurrency
                t={t}
                error={fieldErr("cost")}
                costReg={register("cost")}
                currencyReg={register("currency")}
              />
            </>
          ) : null}

          {/* ---- registration ---- */}
          {category === "registration" ? (
            <>
              <StartEndDates t={t} fieldErr={fieldErr} register={register} />
              <Field
                name="mileage"
                label={t("fields.mileage")}
                type="number"
                inputMode="numeric"
                error={fieldErr("mileage")}
                registration={register("mileage")}
              />
              <NotesField t={t} error={fieldErr("notes")} registration={register("notes")} />
            </>
          ) : null}

          {/* ---- inspection ---- */}
          {category === "inspection" ? (
            <>
              <StartEndDates t={t} fieldErr={fieldErr} register={register} />
              <Field
                name="mileage"
                label={t("fields.mileage")}
                type="number"
                inputMode="numeric"
                error={fieldErr("mileage")}
                registration={register("mileage")}
              />
              <CostCurrency
                t={t}
                error={fieldErr("cost")}
                costReg={register("cost")}
                currencyReg={register("currency")}
              />
              <NotesField t={t} error={fieldErr("notes")} registration={register("notes")} />
            </>
          ) : null}

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

type Translate = ReturnType<typeof useTranslations>;

function StartEndDates({
  t,
  fieldErr,
  register,
}: {
  t: Translate;
  fieldErr: (name: string) => string | null;
  register: UseFormRegister<ScanConfirmFormValues>;
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field
        name="start_date"
        label={t("fields.startDate")}
        type="date"
        error={fieldErr("start_date")}
        registration={register("start_date")}
      />
      <Field
        name="end_date"
        label={t("fields.endDate")}
        type="date"
        error={fieldErr("end_date")}
        registration={register("end_date")}
      />
    </div>
  );
}

function CostCurrency({
  t,
  error,
  costReg,
  currencyReg,
}: {
  t: Translate;
  error: string | null;
  costReg: UseFormRegisterReturn;
  currencyReg: UseFormRegisterReturn;
}) {
  return (
    <div className="grid grid-cols-[1fr_auto] gap-2">
      <Field
        name="cost"
        label={t("fields.cost")}
        type="number"
        inputMode="decimal"
        step="0.01"
        error={error}
        registration={costReg}
      />
      <div className="space-y-1.5">
        <Label htmlFor="currency">{t("fields.currency")}</Label>
        <Select id="currency" {...currencyReg}>
          {CURRENCIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </Select>
      </div>
    </div>
  );
}

function NotesField({
  t,
  error,
  registration,
}: {
  t: Translate;
  error: string | null;
  registration: UseFormRegisterReturn;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor="notes">{t("fields.notes")}</Label>
      <Textarea id="notes" rows={3} {...registration} />
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
    </div>
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
      <Input id={name} aria-invalid={Boolean(error)} {...registration} {...props} />
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
    </div>
  );
}

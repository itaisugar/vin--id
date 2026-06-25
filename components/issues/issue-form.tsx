"use client";

import * as React from "react";
import Link from "next/link";
import {
  useForm,
  useWatch,
  type Resolver,
  type SubmitHandler,
  type UseFormRegisterReturn,
} from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import type { IssueActionState } from "@/app/(app)/vehicles/[id]/issues/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  emptyIssueForm,
  ISSUE_SEVERITIES,
  ISSUE_STATUSES,
  issueInputSchema,
  SELECTABLE_TRUST_LEVELS,
  type IssueFormValues,
  type TrustLevel,
} from "@/lib/issues/types";

interface IssueFormProps {
  mode: "create" | "edit";
  defaultValues?: IssueFormValues;
  action: (values: IssueFormValues) => Promise<IssueActionState>;
  cancelHref: string;
}

const FIELD_NAMES: (keyof IssueFormValues)[] = [
  "date",
  "mileage",
  "symptoms",
  "status",
  "severity",
  "resolution_notes",
  "trust_label",
];

export function IssueForm({
  mode,
  defaultValues = emptyIssueForm(),
  action,
  cancelHref,
}: IssueFormProps) {
  const t = useTranslations("issues");
  const [serverError, setServerError] = React.useState<string | null>(null);

  const {
    register,
    handleSubmit,
    setError,
    control,
    formState: { errors, isSubmitting },
  } = useForm<IssueFormValues>({
    resolver: zodResolver(
      issueInputSchema,
    ) as unknown as Resolver<IssueFormValues>,
    defaultValues,
  });

  const onSubmit: SubmitHandler<IssueFormValues> = async (values) => {
    setServerError(null);
    const result = await action(values);
    if (result?.fieldErrors) {
      for (const name of FIELD_NAMES) {
        const key = result.fieldErrors[name];
        if (key) setError(name, { message: key });
      }
    }
    if (result?.error) setServerError(result.error);
  };

  const fieldError = (name: keyof IssueFormValues) => {
    const message = errors[name]?.message;
    return message ? t(`form.errors.${message}`) : null;
  };

  const selectedSeverity = useWatch({
    control,
    name: "severity",
    defaultValue: defaultValues.severity,
  });

  const trustOptions: TrustLevel[] = SELECTABLE_TRUST_LEVELS.includes(
    defaultValues.trust_label,
  )
    ? SELECTABLE_TRUST_LEVELS
    : [defaultValues.trust_label, ...SELECTABLE_TRUST_LEVELS];

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-5" noValidate>
      <Field
        name="date"
        label={t("fields.date")}
        required
        type="date"
        error={fieldError("date")}
        registration={register("date")}
      />
      <Field
        name="mileage"
        label={t("fields.mileage")}
        type="number"
        inputMode="numeric"
        className="num"
        error={fieldError("mileage")}
        registration={register("mileage")}
      />

      <div className="space-y-1.5">
        <Label htmlFor="symptoms">
          {t("fields.symptoms")}
          <span className="text-danger"> *</span>
        </Label>
        <Textarea
          id="symptoms"
          placeholder={t("fields.symptomsPlaceholder")}
          aria-invalid={Boolean(fieldError("symptoms"))}
          {...register("symptoms")}
        />
        {fieldError("symptoms") ? (
          <p className="text-sm text-danger">{fieldError("symptoms")}</p>
        ) : null}
      </div>

      {/* Status + severity on one row */}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="status">{t("fields.status")}</Label>
          <Select id="status" {...register("status")}>
            {ISSUE_STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(`statuses.${s}`)}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="severity">{t("fields.severity")}</Label>
          <Select id="severity" {...register("severity")}>
            {ISSUE_SEVERITIES.map((s) => (
              <option key={s} value={s}>
                {t(`severities.${s}`)}
              </option>
            ))}
          </Select>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        {t(`severityHelp.${selectedSeverity}`)}
      </p>

      <div className="space-y-1.5">
        <Label htmlFor="resolution_notes">{t("fields.resolutionNotes")}</Label>
        <Textarea id="resolution_notes" {...register("resolution_notes")} />
        <p className="text-xs text-muted-foreground">
          {t("fields.resolutionNotesHelp")}
        </p>
      </div>

      {/* Trust level */}
      <div className="space-y-1.5">
        <Label htmlFor="trust_label">{t("fields.trustLevel")}</Label>
        <Select id="trust_label" {...register("trust_label")}>
          {trustOptions.map((level) => (
            <option key={level} value={level}>
              {t(`trustLevels.${level}`)}
            </option>
          ))}
        </Select>
        <p className="text-xs text-muted-foreground">{t("trustHelp")}</p>
      </div>

      {serverError ? (
        <p role="alert" className="text-sm text-danger">
          {t(`form.errors.${serverError}`)}
        </p>
      ) : null}

      <div className="flex gap-2">
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting
            ? t("form.saving")
            : mode === "create"
              ? t("form.create")
              : t("form.save")}
        </Button>
        <Link
          href={cancelHref}
          className={cn(
            "inline-flex h-10 items-center justify-center rounded-md border border-border px-4 text-sm font-medium transition-colors hover:bg-muted",
          )}
        >
          {t("form.cancel")}
        </Link>
      </div>
    </form>
  );
}

function Field({
  name,
  label,
  required,
  error,
  registration,
  ...props
}: Omit<React.InputHTMLAttributes<HTMLInputElement>, "name"> & {
  name: string;
  label: string;
  required?: boolean;
  error?: string | null;
  registration: UseFormRegisterReturn;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={name}>
        {label}
        {required ? <span className="text-danger"> *</span> : null}
      </Label>
      <Input
        id={name}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `${name}-error` : undefined}
        {...registration}
        {...props}
      />
      {error ? (
        <p id={`${name}-error`} className="text-sm text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}

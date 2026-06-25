"use client";

import * as React from "react";
import Link from "next/link";
import {
  useForm,
  type Resolver,
  type SubmitHandler,
  type UseFormRegisterReturn,
} from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import type { MaintenanceActionState } from "@/app/(app)/vehicles/[id]/maintenance/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  CURRENCIES,
  emptyMaintenanceForm,
  maintenanceInputSchema,
  SELECTABLE_TRUST_LEVELS,
  type MaintenanceFormValues,
  type TrustLevel,
} from "@/lib/maintenance/types";

interface MaintenanceFormProps {
  mode: "create" | "edit";
  defaultValues?: MaintenanceFormValues;
  action: (values: MaintenanceFormValues) => Promise<MaintenanceActionState>;
  cancelHref: string;
}

const FIELD_NAMES: (keyof MaintenanceFormValues)[] = [
  "date",
  "mileage",
  "category",
  "description",
  "cost",
  "currency",
  "trust_label",
];

export function MaintenanceForm({
  mode,
  defaultValues = emptyMaintenanceForm(),
  action,
  cancelHref,
}: MaintenanceFormProps) {
  const t = useTranslations("maintenance");
  const [serverError, setServerError] = React.useState<string | null>(null);

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<MaintenanceFormValues>({
    resolver: zodResolver(
      maintenanceInputSchema,
    ) as unknown as Resolver<MaintenanceFormValues>,
    defaultValues,
  });

  const onSubmit: SubmitHandler<MaintenanceFormValues> = async (values) => {
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

  const fieldError = (name: keyof MaintenanceFormValues) => {
    const message = errors[name]?.message;
    return message ? t(`form.errors.${message}`) : null;
  };

  // Offer the selectable trust levels, plus the current value if it is a
  // non-selectable (e.g. ai_extracted) value already on the record.
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
      <Field
        name="category"
        label={t("fields.category")}
        placeholder={t("fields.categoryPlaceholder")}
        error={fieldError("category")}
        registration={register("category")}
      />

      <div className="space-y-1.5">
        <Label htmlFor="description">
          {t("fields.description")}
          <span className="text-danger"> *</span>
        </Label>
        <Textarea
          id="description"
          aria-invalid={Boolean(fieldError("description"))}
          {...register("description")}
        />
        {fieldError("description") ? (
          <p className="text-sm text-danger">{fieldError("description")}</p>
        ) : null}
      </div>

      {/* Cost + currency on one row */}
      <div className="grid grid-cols-[1fr_auto] gap-2">
        <Field
          name="cost"
          label={t("fields.cost")}
          type="number"
          inputMode="decimal"
          step="0.01"
          className="num"
          error={fieldError("cost")}
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

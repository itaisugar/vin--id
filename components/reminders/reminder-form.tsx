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
import type { ReminderActionState } from "@/app/(app)/vehicles/[id]/reminders/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  emptyReminderForm,
  REMINDER_STATUSES,
  REMINDER_TYPES,
  reminderInputSchema,
  URGENCIES,
  type ReminderFormValues,
} from "@/lib/reminders/types";

interface ReminderFormProps {
  mode: "create" | "edit";
  defaultValues?: ReminderFormValues;
  action: (values: ReminderFormValues) => Promise<ReminderActionState>;
  cancelHref: string;
}

const FIELD_NAMES: (keyof ReminderFormValues)[] = [
  "title",
  "description",
  "reminder_type",
  "due_date",
  "due_mileage",
  "urgency",
  "status",
];

export function ReminderForm({
  mode,
  defaultValues = emptyReminderForm(),
  action,
  cancelHref,
}: ReminderFormProps) {
  const t = useTranslations("reminders");
  const [serverError, setServerError] = React.useState<string | null>(null);

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<ReminderFormValues>({
    resolver: zodResolver(
      reminderInputSchema,
    ) as unknown as Resolver<ReminderFormValues>,
    defaultValues,
  });

  const onSubmit: SubmitHandler<ReminderFormValues> = async (values) => {
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

  const fieldError = (name: keyof ReminderFormValues) => {
    const message = errors[name]?.message;
    return message ? t(`form.errors.${message}`) : null;
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-5" noValidate>
      <Field
        name="title"
        label={t("fields.title")}
        required
        error={fieldError("title")}
        registration={register("title")}
      />

      <div className="space-y-1.5">
        <Label htmlFor="description">{t("fields.description")}</Label>
        <Textarea id="description" {...register("description")} />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="reminder_type">
          {t("fields.reminderType")}
          <span className="text-danger"> *</span>
        </Label>
        <Select id="reminder_type" {...register("reminder_type")}>
          {REMINDER_TYPES.map((rt) => (
            <option key={rt} value={rt}>
              {t(`types.${rt}`)}
            </option>
          ))}
        </Select>
      </div>

      {/* Due date + mileage (at least one required) */}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          name="due_date"
          label={t("fields.dueDate")}
          type="date"
          error={fieldError("due_date")}
          registration={register("due_date")}
        />
        <Field
          name="due_mileage"
          label={t("fields.dueMileage")}
          type="number"
          inputMode="numeric"
          className="num"
          error={fieldError("due_mileage")}
          registration={register("due_mileage")}
        />
      </div>
      <p className="-mt-3 text-xs text-muted-foreground">
        {t("fields.dueHint")}
      </p>

      {/* Urgency + status */}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="urgency">{t("fields.urgency")}</Label>
          <Select id="urgency" {...register("urgency")}>
            {URGENCIES.map((u) => (
              <option key={u} value={u}>
                {t(`urgencies.${u}`)}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="status">{t("fields.status")}</Label>
          <Select id="status" {...register("status")}>
            {REMINDER_STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(`statuses.${s}`)}
              </option>
            ))}
          </Select>
        </div>
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

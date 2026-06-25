"use client";

import * as React from "react";
import Link from "next/link";
import {
  Controller,
  useForm,
  useWatch,
  type Resolver,
  type SubmitHandler,
  type UseFormRegisterReturn,
} from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import type { VehicleActionState } from "@/app/(app)/vehicles/actions";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import {
  getModelsForMake,
  getVehicleMakes,
  normalizeMakeName,
} from "@/lib/vehicle-data/makes-models";
import { cn } from "@/lib/utils";
import {
  EMPTY_VEHICLE_FORM,
  MILEAGE_UNITS,
  vehicleInputSchema,
  type VehicleFormValues,
} from "@/lib/vehicles/types";

interface VehicleFormProps {
  mode: "create" | "edit";
  defaultValues?: VehicleFormValues;
  /** Returns a state on failure; on success it redirects (never returns). */
  action: (values: VehicleFormValues) => Promise<VehicleActionState>;
  cancelHref: string;
}

const FIELD_NAMES: (keyof VehicleFormValues)[] = [
  "make",
  "model",
  "year",
  "vin",
  "license_plate",
  "mileage",
  "mileage_unit",
  "photo_url",
];

export function VehicleForm({
  mode,
  defaultValues = EMPTY_VEHICLE_FORM,
  action,
  cancelHref,
}: VehicleFormProps) {
  const t = useTranslations("vehicles");
  const [serverError, setServerError] = React.useState<string | null>(null);

  const {
    register,
    handleSubmit,
    setError,
    control,
    setValue,
    getValues,
    formState: { errors, isSubmitting },
  } = useForm<VehicleFormValues>({
    resolver: zodResolver(
      vehicleInputSchema,
    ) as unknown as Resolver<VehicleFormValues>,
    defaultValues,
  });

  const makeOptions = React.useMemo(() => getVehicleMakes(), []);
  const selectedMake = useWatch({ control, name: "make" }) ?? "";
  const modelOptions = React.useMemo(
    () => getModelsForMake(selectedMake),
    [selectedMake],
  );

  // When the make changes to a *known* make whose model list no longer contains
  // the current model, clear the model. We skip this while the user is typing a
  // custom/partial make (unknown make) so existing custom make/model pairs and
  // mid-typing edits are preserved.
  const handleMakeChange = (next: string) => {
    const validModels = getModelsForMake(next);
    if (validModels.length === 0) return;
    const currentModel = normalizeMakeName(getValues("model"));
    if (!currentModel) return;
    const stillValid = validModels.some(
      (m) => m.toLowerCase() === currentModel.toLowerCase(),
    );
    if (!stillValid) setValue("model", "", { shouldValidate: false });
  };

  const onSubmit: SubmitHandler<VehicleFormValues> = async (values) => {
    setServerError(null);
    const result = await action(values);
    // Reaching here means no redirect happened → it failed.
    if (result?.fieldErrors) {
      for (const name of FIELD_NAMES) {
        const key = result.fieldErrors[name];
        if (key) setError(name, { message: key });
      }
    }
    if (result?.error) setServerError(result.error);
  };

  // Resolve a field's error message key into translated text.
  const fieldError = (name: keyof VehicleFormValues) => {
    const message = errors[name]?.message;
    return message ? t(`form.errors.${message}`) : null;
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-5" noValidate>
      <Controller
        control={control}
        name="make"
        render={({ field }) => (
          <ComboField
            name="make"
            label={t("fields.make")}
            required
            helper={t("helpers.make")}
            placeholder={t("combobox.searchPlaceholder")}
            clearLabel={t("combobox.clear")}
            noResultsLabel={t("combobox.noResults")}
            options={makeOptions}
            value={field.value}
            onBlur={field.onBlur}
            onChange={(next) => {
              field.onChange(next);
              handleMakeChange(next);
            }}
            error={fieldError("make")}
          />
        )}
      />
      <Controller
        control={control}
        name="model"
        render={({ field }) => {
          const hasMake = normalizeMakeName(selectedMake).length > 0;
          return (
            <ComboField
              name="model"
              label={t("fields.model")}
              required
              helper={
                hasMake
                  ? t("helpers.model")
                  : t("helpers.modelSelectMakeFirst")
              }
              placeholder={t("combobox.searchPlaceholder")}
              clearLabel={t("combobox.clear")}
              noResultsLabel={t("combobox.noResults")}
              disabled={!hasMake}
              options={modelOptions}
              value={field.value}
              onBlur={field.onBlur}
              onChange={field.onChange}
              error={fieldError("model")}
            />
          );
        }}
      />
      <Field
        name="year"
        label={t("fields.year")}
        required
        type="number"
        inputMode="numeric"
        className="num"
        placeholder={t("fields.yearPlaceholder")}
        error={fieldError("year")}
        registration={register("year")}
      />
      <Field
        name="vin"
        label={t("fields.vin")}
        className="num"
        error={fieldError("vin")}
        registration={register("vin")}
      />
      <Field
        name="license_plate"
        label={t("fields.licensePlate")}
        className="num"
        error={fieldError("license_plate")}
        registration={register("license_plate")}
      />

      {/* Mileage + unit on one row */}
      <div className="grid grid-cols-[1fr_auto] gap-2">
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
          <Label htmlFor="mileage_unit">{t("fields.mileageUnit")}</Label>
          <Select id="mileage_unit" {...register("mileage_unit")}>
            {MILEAGE_UNITS.map((unit) => (
              <option key={unit} value={unit}>
                {t(`units.${unit}`)}
              </option>
            ))}
          </Select>
        </div>
      </div>

      <Field
        name="photo_url"
        label={t("fields.photoUrl")}
        type="url"
        placeholder="https://…"
        error={fieldError("photo_url")}
        registration={register("photo_url")}
      />

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

// Labelled searchable combobox row (make/model), with helper + error text.
function ComboField({
  name,
  label,
  required,
  helper,
  error,
  options,
  value,
  onChange,
  onBlur,
  disabled,
  placeholder,
  clearLabel,
  noResultsLabel,
}: {
  name: string;
  label: string;
  required?: boolean;
  helper?: string;
  error?: string | null;
  options: string[];
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  disabled?: boolean;
  placeholder?: string;
  clearLabel?: string;
  noResultsLabel?: string;
}) {
  const helperId = `${name}-helper`;
  const errorId = `${name}-error`;
  return (
    <div className="space-y-1.5">
      <Label htmlFor={name}>
        {label}
        {required ? <span className="text-danger"> *</span> : null}
      </Label>
      <Combobox
        id={name}
        options={options}
        value={value}
        onChange={onChange}
        onBlur={onBlur}
        disabled={disabled}
        placeholder={placeholder}
        clearLabel={clearLabel}
        noResultsLabel={noResultsLabel}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? errorId : helper ? helperId : undefined}
      />
      {error ? (
        <p id={errorId} className="text-sm text-danger">
          {error}
        </p>
      ) : helper ? (
        <p id={helperId} className="text-sm text-muted-foreground">
          {helper}
        </p>
      ) : null}
    </div>
  );
}

// Small labelled input row. `registration` carries RHF's name/onChange/ref.
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

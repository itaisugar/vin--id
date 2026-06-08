"use client";

import * as React from "react";
import Link from "next/link";
import {
  useForm,
  type Resolver,
  type SubmitHandler,
} from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { createDiagnosisAction } from "@/app/(app)/diagnose/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  diagnosisInputSchema,
  type DiagnosisFormValues,
} from "@/lib/diagnosis/types";

export interface DiagnoseVehicleOption {
  id: string;
  label: string;
  currentMileage: number | null;
}

export function DiagnoseForm({
  vehicles,
  defaultVehicleId,
  cancelHref,
}: {
  vehicles: DiagnoseVehicleOption[];
  defaultVehicleId?: string;
  cancelHref: string;
}) {
  const t = useTranslations("diagnose");
  const [serverError, setServerError] = React.useState<string | null>(null);

  const initialVehicle =
    vehicles.find((v) => v.id === defaultVehicleId) ?? vehicles[0];

  const {
    register,
    handleSubmit,
    setError,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<DiagnosisFormValues>({
    resolver: zodResolver(
      diagnosisInputSchema,
    ) as unknown as Resolver<DiagnosisFormValues>,
    defaultValues: {
      vehicleId: initialVehicle?.id ?? "",
      symptoms: "",
      mileage:
        initialVehicle?.currentMileage != null
          ? String(initialVehicle.currentMileage)
          : "",
    },
  });

  const onVehicleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const v = vehicles.find((x) => x.id === e.target.value);
    setValue(
      "mileage",
      v?.currentMileage != null ? String(v.currentMileage) : "",
    );
  };

  const onSubmit: SubmitHandler<DiagnosisFormValues> = async (values) => {
    setServerError(null);
    const result = await createDiagnosisAction(values);
    if (result?.fieldErrors) {
      (["vehicleId", "symptoms", "mileage"] as const).forEach((name) => {
        const key = result.fieldErrors?.[name];
        if (key) setError(name, { message: key });
      });
    }
    if (result?.error) setServerError(result.error);
  };

  const fieldError = (name: keyof DiagnosisFormValues) => {
    const message = errors[name]?.message;
    return message ? t(`form.errors.${message}`) : null;
  };

  const { onChange: registerVehicleOnChange, ...vehicleReg } =
    register("vehicleId");

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-5" noValidate>
      <div className="space-y-1.5">
        <Label htmlFor="vehicleId">
          {t("form.vehicle")}
          <span className="text-red-600"> *</span>
        </Label>
        <Select
          id="vehicleId"
          {...vehicleReg}
          onChange={(e) => {
            registerVehicleOnChange(e);
            onVehicleChange(e);
          }}
        >
          {vehicles.map((v) => (
            <option key={v.id} value={v.id}>
              {v.label}
            </option>
          ))}
        </Select>
        {fieldError("vehicleId") ? (
          <p className="text-sm text-red-600">{fieldError("vehicleId")}</p>
        ) : null}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="symptoms">
          {t("form.symptoms")}
          <span className="text-red-600"> *</span>
        </Label>
        <Textarea
          id="symptoms"
          rows={5}
          placeholder={t("form.symptomsPlaceholder")}
          aria-invalid={Boolean(fieldError("symptoms"))}
          {...register("symptoms")}
        />
        {fieldError("symptoms") ? (
          <p className="text-sm text-red-600">{fieldError("symptoms")}</p>
        ) : null}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="mileage">{t("form.mileage")}</Label>
        <Input
          id="mileage"
          type="number"
          inputMode="numeric"
          {...register("mileage")}
        />
        {fieldError("mileage") ? (
          <p className="text-sm text-red-600">{fieldError("mileage")}</p>
        ) : null}
      </div>

      {serverError ? (
        <p role="alert" className="text-sm text-red-600">
          {t(`form.errors.${serverError}`)}
        </p>
      ) : null}

      <div className="flex gap-2">
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? t("form.analyzing") : t("form.start")}
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

"use client";

import * as React from "react";
import {
  useForm,
  type Resolver,
  type SubmitHandler,
} from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import {
  confirmExtractionAction,
  discardExtractionAction,
} from "@/app/(app)/vehicles/[id]/documents/extraction-actions";
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
import {
  confirmExtractionSchema,
  extractionToFormValues,
  type ConfirmExtractionFormValues,
  type ExtractionResult,
  type FieldConfidence,
} from "@/lib/documents/extraction-types";
import { CURRENCIES, DOCUMENT_TYPES } from "@/lib/documents/types";
import type { DocumentType } from "@/lib/documents/types";

const CONF_TONE: Record<FieldConfidence, "muted" | "neutral" | "success"> = {
  low: "muted",
  medium: "neutral",
  high: "success",
};

interface Fallback {
  document_type: DocumentType;
  document_date: string | null;
  expiry_date: string | null;
  vendor: string | null;
  amount: number | null;
  currency: string;
}

export function ExtractionReview({
  vehicleId,
  documentId,
  extractionId,
  result,
  fallback,
  containsPersonalInfo,
}: {
  vehicleId: string;
  documentId: string;
  extractionId: string;
  result: ExtractionResult;
  fallback: Fallback;
  containsPersonalInfo: boolean;
}) {
  const t = useTranslations("documents.extraction");
  const td = useTranslations("documents");
  const [serverError, setServerError] = React.useState<string | null>(null);
  const [isDiscarding, startDiscard] = React.useTransition();

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ConfirmExtractionFormValues>({
    resolver: zodResolver(
      confirmExtractionSchema,
    ) as unknown as Resolver<ConfirmExtractionFormValues>,
    defaultValues: extractionToFormValues(result, fallback),
  });

  const onConfirm: SubmitHandler<ConfirmExtractionFormValues> = async (
    values,
  ) => {
    setServerError(null);
    const res = await confirmExtractionAction(
      vehicleId,
      documentId,
      extractionId,
      values,
    );
    if (res?.error) setServerError(res.error);
  };

  const onDiscard = () => {
    setServerError(null);
    startDiscard(async () => {
      const res = await discardExtractionAction(
        vehicleId,
        documentId,
        extractionId,
      );
      if (res?.error) setServerError(res.error);
    });
  };

  const conf = (k: keyof ExtractionResult["fields"]) =>
    result.fields[k].confidence;
  const fieldErr = (name: keyof ConfirmExtractionFormValues) => {
    const m = errors[name]?.message;
    return m ? t(`errors.${m}`) : null;
  };

  return (
    <Card className="border-primary/40">
      <CardHeader className="space-y-1">
        <CardTitle className="text-base">{t("review.title")}</CardTitle>
        <p className="text-xs text-muted-foreground">{t("review.help")}</p>
        <p className="rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground">
          {t("mockNotice")}
        </p>
        {containsPersonalInfo ? (
          <p className="rounded-md bg-amber-500/15 px-2 py-1 text-xs text-amber-700 dark:text-amber-400">
            {td("privacyWarning")}
          </p>
        ) : null}
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit(onConfirm)} className="space-y-4" noValidate>
          {/* document_type */}
          <Field label={td("fields.documentType")} confidence={conf("document_type")} t={t}>
            <Select id="document_type" {...register("document_type")}>
              {DOCUMENT_TYPES.map((dt) => (
                <option key={dt} value={dt}>
                  {td(`documentTypes.${dt}`)}
                </option>
              ))}
            </Select>
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={td("fields.documentDate")} confidence={conf("document_date")} t={t} error={fieldErr("document_date")}>
              <Input id="document_date" type="date" {...register("document_date")} />
            </Field>
            <Field label={td("fields.expiryDate")} confidence={conf("expiry_date")} t={t} error={fieldErr("expiry_date")}>
              <Input id="expiry_date" type="date" {...register("expiry_date")} />
            </Field>
          </div>

          <Field label={td("fields.vendor")} confidence={conf("vendor")} t={t} error={fieldErr("vendor")}>
            <Input id="vendor" {...register("vendor")} />
          </Field>

          <div className="grid grid-cols-[1fr_auto] gap-2">
            <Field label={td("fields.amount")} confidence={conf("amount")} t={t} error={fieldErr("amount")}>
              <Input id="amount" type="number" inputMode="decimal" step="0.01" {...register("amount")} />
            </Field>
            <div className="space-y-1.5">
              <Label htmlFor="currency">{td("fields.currency")}</Label>
              <Select id="currency" {...register("currency")}>
                {CURRENCIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </Select>
            </div>
          </div>

          {serverError ? (
            <p role="alert" className="text-sm text-red-600">
              {t(`errors.${serverError}`)}
            </p>
          ) : null}

          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={isSubmitting || isDiscarding}>
              {isSubmitting ? t("review.confirming") : t("review.confirm")}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={onDiscard}
              disabled={isSubmitting || isDiscarding}
            >
              {isDiscarding ? t("review.discarding") : t("review.discard")}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function Field({
  label,
  confidence,
  error,
  t,
  children,
}: {
  label: string;
  confidence: FieldConfidence;
  error?: string | null;
  t: (key: string) => string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <Label>{label}</Label>
        <Badge tone={CONF_TONE[confidence]}>
          {t(`confidence.${confidence}`)} · {t("source")}
        </Badge>
      </div>
      {children}
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
    </div>
  );
}

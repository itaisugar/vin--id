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
import {
  createDocumentAction,
  updateDocumentAction,
} from "@/app/(app)/vehicles/[id]/documents/actions";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import {
  CURRENCIES,
  DOCUMENT_TYPES,
  DOCUMENTS_BUCKET,
  documentMetadataSchema,
  emptyDocumentForm,
  isAllowedMime,
  MAX_FILE_SIZE,
  sanitizeFilename,
  SELECTABLE_TRUST_LEVELS,
  type DocumentFormValues,
  type TrustLevel,
} from "@/lib/documents/types";

interface DocumentFormProps {
  mode: "create" | "edit";
  vehicleId: string;
  documentId?: string;
  defaultValues?: DocumentFormValues;
  cancelHref: string;
}

const METADATA_FIELDS: (keyof DocumentFormValues)[] = [
  "document_type",
  "document_date",
  "expiry_date",
  "vendor",
  "amount",
  "currency",
  "contains_personal_info",
  "share_allowed",
  "trust_label",
];

export function DocumentForm({
  mode,
  vehicleId,
  documentId,
  defaultValues = emptyDocumentForm(),
  cancelHref,
}: DocumentFormProps) {
  const t = useTranslations("documents");
  const [serverError, setServerError] = React.useState<string | null>(null);
  const [file, setFile] = React.useState<File | null>(null);
  const [fileError, setFileError] = React.useState<string | null>(null);

  const {
    register,
    handleSubmit,
    setError,
    control,
    formState: { errors, isSubmitting },
  } = useForm<DocumentFormValues>({
    resolver: zodResolver(
      documentMetadataSchema,
    ) as unknown as Resolver<DocumentFormValues>,
    defaultValues,
  });

  const containsPersonal = useWatch({
    control,
    name: "contains_personal_info",
    defaultValue: defaultValues.contains_personal_info,
  });
  const shareAllowed = useWatch({
    control,
    name: "share_allowed",
    defaultValue: defaultValues.share_allowed,
  });

  const fieldError = (name: keyof DocumentFormValues) => {
    const message = errors[name]?.message;
    return message ? t(`form.errors.${message}`) : null;
  };

  const applyServerErrors = (result?: {
    error?: string;
    fieldErrors?: Partial<Record<string, string>>;
  }) => {
    if (result?.fieldErrors) {
      for (const name of METADATA_FIELDS) {
        const key = result.fieldErrors[name];
        if (key) setError(name, { message: key });
      }
    }
    if (result?.error) setServerError(result.error);
  };

  const onSubmit: SubmitHandler<DocumentFormValues> = async (values) => {
    setServerError(null);

    if (mode === "edit") {
      if (!documentId) return;
      const result = await updateDocumentAction(vehicleId, documentId, values);
      applyServerErrors(result);
      return;
    }

    // create: validate + upload the file, then persist metadata.
    setFileError(null);
    if (!file) {
      setFileError("fileRequired");
      return;
    }
    if (!isAllowedMime(file.type)) {
      setFileError("invalidFileType");
      return;
    }
    if (file.size > MAX_FILE_SIZE) {
      setFileError("fileTooLarge");
      return;
    }

    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setServerError("saveFailed");
      return;
    }

    const newId = crypto.randomUUID();
    const safeName = sanitizeFilename(file.name);
    const path = `${user.id}/${vehicleId}/${newId}/${safeName}`;

    const { error: uploadError } = await supabase.storage
      .from(DOCUMENTS_BUCKET)
      .upload(path, file, { contentType: file.type, upsert: false });

    if (uploadError) {
      setServerError("uploadFailed");
      return;
    }

    const result = await createDocumentAction(vehicleId, {
      ...values,
      documentId: newId,
      storage_path: path,
      file_name: file.name,
      mime_type: file.type,
      file_size: file.size,
    });

    // Reaching here means it failed (success redirects). Clean up the orphan.
    if (result?.error || result?.fieldErrors) {
      await supabase.storage.from(DOCUMENTS_BUCKET).remove([path]);
    }
    applyServerErrors(result);
  };

  const trustOptions: TrustLevel[] = SELECTABLE_TRUST_LEVELS.includes(
    defaultValues.trust_label,
  )
    ? SELECTABLE_TRUST_LEVELS
    : [defaultValues.trust_label, ...SELECTABLE_TRUST_LEVELS];

  const showPrivacyWarning = containsPersonal && shareAllowed;

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-5" noValidate>
      {mode === "create" ? (
        <div className="space-y-1.5">
          <Label htmlFor="file">
            {t("fields.file")}
            <span className="text-red-600"> *</span>
          </Label>
          <Input
            id="file"
            type="file"
            accept=".pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png,image/webp"
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null);
              setFileError(null);
            }}
            className="h-auto py-2"
          />
          <p className="text-xs text-muted-foreground">{t("fields.fileHelp")}</p>
          {fileError ? (
            <p className="text-sm text-red-600">{t(`form.errors.${fileError}`)}</p>
          ) : null}
        </div>
      ) : null}

      <div className="space-y-1.5">
        <Label htmlFor="document_type">
          {t("fields.documentType")}
          <span className="text-red-600"> *</span>
        </Label>
        <Select id="document_type" {...register("document_type")}>
          {DOCUMENT_TYPES.map((dt) => (
            <option key={dt} value={dt}>
              {t(`documentTypes.${dt}`)}
            </option>
          ))}
        </Select>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          name="document_date"
          label={t("fields.documentDate")}
          type="date"
          error={fieldError("document_date")}
          registration={register("document_date")}
        />
        <Field
          name="expiry_date"
          label={t("fields.expiryDate")}
          type="date"
          error={fieldError("expiry_date")}
          registration={register("expiry_date")}
        />
      </div>

      <Field
        name="vendor"
        label={t("fields.vendor")}
        error={fieldError("vendor")}
        registration={register("vendor")}
      />

      <div className="grid grid-cols-[1fr_auto] gap-2">
        <Field
          name="amount"
          label={t("fields.amount")}
          type="number"
          inputMode="decimal"
          step="0.01"
          error={fieldError("amount")}
          registration={register("amount")}
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

      {/* Privacy flags */}
      <div className="space-y-2 rounded-md border border-border p-3">
        <label className="flex items-center gap-2 text-sm">
          <Checkbox {...register("contains_personal_info")} />
          {t("fields.containsPersonalInfo")}
        </label>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox {...register("share_allowed")} />
          {t("fields.shareAllowed")}
        </label>
        {showPrivacyWarning ? (
          <p className="rounded-md bg-amber-500/15 p-2 text-xs text-amber-700 dark:text-amber-400">
            {t("privacyWarning")}
          </p>
        ) : null}
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
        <p role="alert" className="text-sm text-red-600">
          {t(`form.errors.${serverError}`)}
        </p>
      ) : null}

      <div className="flex gap-2">
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting
            ? mode === "create"
              ? t("form.uploading")
              : t("form.saving")
            : mode === "create"
              ? t("form.upload")
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
        aria-describedby={error ? `${name}-error` : undefined}
        {...registration}
        {...props}
      />
      {error ? (
        <p id={`${name}-error`} className="text-sm text-red-600">
          {error}
        </p>
      ) : null}
    </div>
  );
}

"use client";

import * as React from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { scanExtractAction } from "@/app/(app)/scan/actions";
import { ScanConfirmForm } from "@/components/scan/scan-confirm-form";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  isScanImageMime,
  MAX_SCAN_FILE_SIZE,
  type ScanExtraction,
} from "@/lib/documents/scan/types";

export interface ScanVehicleOption {
  id: string;
  label: string;
}

/** Defaults used when extraction fails — the user falls back to manual entry. */
const EMPTY_EXTRACTION: ScanExtraction = {
  date: null,
  service_or_work_description: null,
  mileage: null,
  cost: null,
  vendor: null,
  document_type_guess: "unknown",
  confidence: null,
};

type Confirm = {
  extraction: ScanExtraction;
  engine: "mock" | "anthropic" | "none";
};

/**
 * Client orchestrator: pick a vehicle, choose/capture an image, pass the consent
 * notice, then run server-side extraction. On success (or graceful failure) it
 * hands off to the pre-filled confirmation form. Nothing is saved until confirm.
 */
export function ScanFlow({
  vehicles,
  defaultVehicleId,
  cancelHref,
}: {
  vehicles: ScanVehicleOption[];
  defaultVehicleId?: string;
  cancelHref: string;
}) {
  const t = useTranslations("scan");

  const [vehicleId, setVehicleId] = React.useState(
    vehicles.find((v) => v.id === defaultVehicleId)?.id ?? vehicles[0]?.id ?? "",
  );
  const [file, setFile] = React.useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = React.useState<string | null>(null);
  const [consent, setConsent] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [confirm, setConfirm] = React.useState<Confirm | null>(null);
  const [isPending, startTransition] = React.useTransition();

  // Track the current object URL so we can revoke it without a state-syncing
  // effect (creating/revoking happens in the change handler, not in render).
  const previewUrlRef = React.useRef<string | null>(null);
  React.useEffect(
    () => () => {
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    },
    [],
  );

  const selectFile = (f: File | null) => {
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = null;
    }
    const url = f ? URL.createObjectURL(f) : null;
    previewUrlRef.current = url;
    setPreviewUrl(url);
    setFile(f);
  };

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0] ?? null;
    setError(null);
    if (f && f.type === "application/pdf") {
      setError("pdfNotSupported");
      selectFile(null);
      return;
    }
    if (f && !isScanImageMime(f.type)) {
      setError("invalidFileType");
      selectFile(null);
      return;
    }
    if (f && f.size > MAX_SCAN_FILE_SIZE) {
      setError("fileTooLarge");
      selectFile(null);
      return;
    }
    selectFile(f);
  };

  const onScan = () => {
    setError(null);
    if (!file) {
      setError("fileRequired");
      return;
    }
    if (!consent) {
      setError("consentRequired");
      return;
    }

    const fd = new FormData();
    fd.set("vehicleId", vehicleId);
    fd.set("consent", "true");
    fd.set("file", file);

    startTransition(async () => {
      const res = await scanExtractAction(fd);
      if (res.ok) {
        setConfirm({
          extraction: res.response.extraction,
          engine: res.response.engine,
        });
        return;
      }
      if (res.error === "extractFailed") {
        // Graceful fallback: open the confirmation form for manual entry.
        setConfirm({ extraction: EMPTY_EXTRACTION, engine: "none" });
        setError("extractFailed");
        return;
      }
      setError(res.error);
    });
  };

  if (confirm) {
    return (
      <ScanConfirmForm
        vehicleId={vehicleId}
        extraction={confirm.extraction}
        engine={confirm.engine}
        failed={error === "extractFailed"}
        cancelHref={cancelHref}
        onBack={() => {
          setConfirm(null);
          setError(null);
        }}
      />
    );
  }

  return (
    <div className="space-y-5">
      {/* Vehicle */}
      <div className="space-y-1.5">
        <Label htmlFor="scan-vehicle">{t("fields.vehicle")}</Label>
        <Select
          id="scan-vehicle"
          value={vehicleId}
          onChange={(e) => setVehicleId(e.target.value)}
        >
          {vehicles.map((v) => (
            <option key={v.id} value={v.id}>
              {v.label}
            </option>
          ))}
        </Select>
      </div>

      {/* File input — no forced `capture`, so mobile shows the native chooser
          (Camera + Photo Library + Files). `accept="image/*"` keeps the picker
          to images (incl. iOS HEIC, converted to JPEG on pick); the actual
          jpeg/png/webp + size limits are enforced in onFileChange + server. */}
      <div className="space-y-1.5">
        <Label htmlFor="scan-file">{t("fields.file")}</Label>
        <Input
          id="scan-file"
          type="file"
          accept="image/*"
          onChange={onFileChange}
          className="h-auto py-2"
        />
        <p className="text-xs text-muted-foreground">{t("fields.fileHelp")}</p>
        {previewUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={previewUrl}
            alt={file?.name ?? ""}
            className="max-h-64 w-full rounded-md border border-border object-contain"
          />
        ) : null}
      </div>

      {/* Consent notice (required before sending to a third-party provider) */}
      <div className="space-y-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3">
        <p className="text-sm font-medium">{t("consent.title")}</p>
        <p className="text-xs text-muted-foreground">{t("consent.body")}</p>
        <label className="flex items-start gap-2 text-sm">
          <Checkbox
            checked={consent}
            onChange={(e) => setConsent(e.target.checked)}
          />
          <span>{t("consent.checkbox")}</span>
        </label>
      </div>

      {error ? (
        <p role="alert" className="text-sm text-red-600">
          {t(`errors.${error}`)}
        </p>
      ) : null}

      <div className="flex gap-2">
        <Button
          type="button"
          onClick={onScan}
          disabled={isPending || !file || !consent}
        >
          {isPending ? t("actions.scanning") : t("actions.scan")}
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

      {/* TODO(scan-pdf): support PDF receipts (send as a document block). */}
    </div>
  );
}

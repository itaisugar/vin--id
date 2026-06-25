"use client";

import * as React from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { scanExtractAction } from "@/app/(app)/scan/actions";
import { ScanConfirmForm } from "@/components/scan/scan-confirm-form";
import { DocumentIcon } from "@/components/icons";
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
import type { MileageUnit } from "@/lib/vehicles/types";

export interface ScanVehicleOption {
  id: string;
  label: string;
  mileageUnit: MileageUnit;
}

/** Defaults used when extraction fails — the user falls back to manual entry. */
const EMPTY_EXTRACTION: ScanExtraction = {
  document_category: "unknown",
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
    const selected = vehicles.find((v) => v.id === vehicleId);
    return (
      <ScanConfirmForm
        vehicleId={vehicleId}
        vehicleMileageUnit={selected?.mileageUnit ?? "km"}
        extraction={confirm.extraction}
        engine={confirm.engine}
        file={file}
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
      <div className="space-y-2">
        <Label htmlFor="scan-file">{t("fields.file")}</Label>

        {/* Scan viewport — preview framed by amber corner brackets; a scan line
            sweeps while extraction runs (status pill at the bottom). */}
        <div className="relative mx-auto aspect-[3/4] w-full max-w-xs overflow-hidden rounded-2xl border border-line [background:radial-gradient(circle_at_50%_40%,#15181d,#0c0e11)]">
          {previewUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={previewUrl}
              alt={file?.name ?? ""}
              className="absolute inset-0 h-full w-full object-contain p-3"
            />
          ) : (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-4 text-center text-ink-3">
              <DocumentIcon className="h-10 w-10" />
            </div>
          )}

          {/* Amber corner brackets */}
          <span className="pointer-events-none absolute left-3 top-3 h-7 w-7 rounded-tl-lg border-l-2 border-t-2 border-accent" />
          <span className="pointer-events-none absolute right-3 top-3 h-7 w-7 rounded-tr-lg border-r-2 border-t-2 border-accent" />
          <span className="pointer-events-none absolute bottom-3 left-3 h-7 w-7 rounded-bl-lg border-b-2 border-l-2 border-accent" />
          <span className="pointer-events-none absolute bottom-3 right-3 h-7 w-7 rounded-br-lg border-b-2 border-r-2 border-accent" />

          {isPending ? (
            <>
              <span className="animate-scan-sweep pointer-events-none absolute inset-x-4 h-0.5 -translate-y-1/2 bg-accent shadow-[0_0_12px_2px_rgba(255,138,43,0.6)]" />
              <span className="absolute inset-x-0 bottom-4 mx-auto flex w-fit items-center gap-2 rounded-full bg-bg/80 px-3 py-1.5 text-xs font-medium backdrop-blur">
                <span className="h-1.5 w-1.5 animate-pulse-dot rounded-full bg-accent" />
                {t("actions.scanning")}
              </span>
            </>
          ) : null}
        </div>

        <Input
          id="scan-file"
          type="file"
          accept="image/*"
          onChange={onFileChange}
          className="h-auto py-2"
        />
        <p className="text-xs text-ink-3">{t("fields.fileHelp")}</p>
      </div>

      {/* Consent notice (required before sending to a third-party provider) */}
      <div className="space-y-2 rounded-2xl border border-warn/30 bg-warn/10 p-3">
        <p className="text-sm font-semibold">{t("consent.title")}</p>
        <p className="text-xs text-ink-2">{t("consent.body")}</p>
        <label className="flex items-start gap-2 text-sm">
          <Checkbox
            checked={consent}
            onChange={(e) => setConsent(e.target.checked)}
          />
          <span>{t("consent.checkbox")}</span>
        </label>
      </div>

      {error ? (
        <p role="alert" className="text-sm font-medium text-danger">
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
            "inline-flex h-11 items-center justify-center rounded-xl border border-line bg-surface-2 px-4 text-sm font-medium transition hover:bg-surface active:scale-[.98]",
          )}
        >
          {t("actions.cancel")}
        </Link>
      </div>

      {/* TODO(scan-pdf): support PDF receipts (send as a document block). */}
    </div>
  );
}

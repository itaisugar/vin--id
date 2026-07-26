"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { uploadAndExtractAction } from "@/app/(app)/fleet-intake/actions";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import type { IntakeVehicleOption } from "./intake-review-form";

/**
 * Upload a document and run extraction.
 *
 * Extraction is a PAID call, so it happens only on this explicit button press —
 * never on page load, never on file selection. The vehicle picker is optional:
 * leaving it empty is the Fleet Dashboard case where the document is expected
 * to name its own vehicle.
 */
export function IntakeUploadForm({
  vehicles,
  presetVehicleId,
}: {
  vehicles: IntakeVehicleOption[];
  presetVehicleId?: string;
}) {
  const t = useTranslations("fleet.intake");
  const tErrors = useTranslations("fleet.intake.errors");
  const router = useRouter();

  const [file, setFile] = React.useState<File | null>(null);
  const [vehicleId, setVehicleId] = React.useState(presetVehicleId ?? "");
  const [error, setError] = React.useState<string | null>(null);
  const [isPending, startTransition] = React.useTransition();

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (!file) return setError(tErrors("fileRequired"));

    const formData = new FormData();
    formData.set("file", file);
    if (vehicleId) formData.set("vehicleId", vehicleId);

    startTransition(async () => {
      const state = await uploadAndExtractAction(formData);
      if (!state.ok) {
        setError(tErrors(state.error));
        return;
      }
      router.push(`/fleet-intake/${state.intakeId}`);
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="intake-file">{t("fileLabel")}</Label>
        <input
          id="intake-file"
          type="file"
          accept="image/jpeg,image/png,image/webp"
          capture="environment"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="block w-full rounded-xl border border-line bg-surface-2 p-2 text-sm file:me-3 file:rounded-lg file:border-0 file:bg-surface file:px-3 file:py-1.5 file:text-sm file:text-ink"
        />
        <p className="text-xs text-ink-3">{t("fileHelp")}</p>
      </div>

      {presetVehicleId ? null : (
        <div className="space-y-1.5">
          <Label htmlFor="intake-upload-vehicle">{t("vehicleOptionalLabel")}</Label>
          <Select
            id="intake-upload-vehicle"
            value={vehicleId}
            onChange={(e) => setVehicleId(e.target.value)}
          >
            <option value="">{t("vehicleUnknown")}</option>
            {vehicles.map((v) => (
              <option key={v.id} value={v.id}>
                {v.licensePlate ? `${v.licensePlate} — ${v.label}` : v.label}
              </option>
            ))}
          </Select>
          <p className="text-xs text-ink-3">{t("vehicleOptionalHelp")}</p>
        </div>
      )}

      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}

      <Button type="submit" disabled={isPending || !file}>
        {isPending ? t("extracting") : t("uploadAndExtract")}
      </Button>
      <p className="text-xs text-ink-3">{t("consentNote")}</p>
    </form>
  );
}

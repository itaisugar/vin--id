"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { lookupVehicleAction, type VehicleActionState } from "@/app/(app)/vehicles/actions";
import {
  createRegistrationIntakeAction,
  confirmRegistrationIntakeAction,
} from "@/app/(app)/vehicles/registration-intake-actions";
import { VehicleForm } from "@/components/vehicles/vehicle-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { compareVehicleSources, type VehicleSourceComparison } from "@/lib/vehicle-intake/compare";
import type { VehicleRegistrationExtraction } from "@/lib/vehicle-intake/extraction-types";
import type { VehicleLookupDraft } from "@/lib/vehicle-lookup/types";
import { normalizeRegistration } from "@/lib/vehicle-lookup/normalize-registration";
import { MAX_SCAN_FILE_SIZE } from "@/lib/documents/scan/types";
import { EMPTY_VEHICLE_FORM, type VehicleFormValues } from "@/lib/vehicles/types";

/**
 * Scan-registration sub-flow: upload → extract → registration review →
 * (optional) government lookup → combined Review (reusing VehicleForm) → confirm.
 * No vehicle is created until the final VehicleForm submission.
 */
type Step = "upload" | "extracting" | "wrongDoc" | "plate" | "looking" | "review";

function mergedDefaults(cmp: VehicleSourceComparison): VehicleFormValues {
  const v = (f: keyof VehicleSourceComparison["fields"]) => cmp.fields[f].proposed ?? "";
  return {
    ...EMPTY_VEHICLE_FORM,
    make: v("make"),
    model: v("model"),
    year: v("year"),
    vin: v("vin"),
    license_plate: v("registration_number"),
    color: v("color"),
    fuel_type: v("fuel_type"),
    test_expiry_date: v("test_expiry_date"),
  };
}

export function ScanRegistrationFlow({
  cancelHref,
  onBack,
}: {
  cancelHref: string;
  onBack: () => void;
}) {
  const tl = useTranslations("vehicles.lookup");
  const ts = useTranslations("vehicles.scan");

  const [step, setStep] = React.useState<Step>("upload");
  const [error, setError] = React.useState<string | null>(null);
  const [intakeId, setIntakeId] = React.useState<string | null>(null);
  const [extraction, setExtraction] = React.useState<VehicleRegistrationExtraction | null>(null);
  const [plate, setPlate] = React.useState("");
  const [gov, setGov] = React.useState<VehicleLookupDraft | null>(null);
  const [govMeta, setGovMeta] = React.useState<{ fetched_at: string; resource_id: string } | null>(null);
  const [comparison, setComparison] = React.useState<VehicleSourceComparison | null>(null);
  const [createReminder, setCreateReminder] = React.useState(false);
  const [isPending, startTransition] = React.useTransition();

  function onUpload(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const form = new FormData(e.currentTarget);
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) {
      setError(ts("errors.fileRequired"));
      return;
    }
    // Client-side size guard for immediate feedback and to avoid hitting the
    // Server Action transport ceiling on very large files. The server still
    // enforces the 10MB limit (this check is UX, not security).
    if (file.size > MAX_SCAN_FILE_SIZE) {
      setError(ts("errors.fileTooLarge"));
      return;
    }
    setStep("extracting");
    startTransition(async () => {
      const res = await createRegistrationIntakeAction(form);
      if (!res.ok) {
        setError(ts(`errors.${res.error}`));
        setStep("upload");
        return;
      }
      setIntakeId(res.intakeId);
      setExtraction(res.extraction);
      if (res.extraction.document_type === "other") {
        setStep("wrongDoc");
        return;
      }
      setPlate(res.extraction.registration_number.value ?? "");
      setStep("plate");
    });
  }

  function runLookup(skip: boolean) {
    if (!extraction) return;
    setError(null);
    if (skip) {
      const cmp = compareVehicleSources(extraction, null);
      setGov(null);
      setGovMeta(null);
      setComparison(cmp);
      setStep("review");
      return;
    }
    const norm = normalizeRegistration(plate);
    if (!norm.ok) {
      setError(tl(`format.${norm.reason}`));
      return;
    }
    setStep("looking");
    startTransition(async () => {
      const state = await lookupVehicleAction(plate);
      let govDraft: VehicleLookupDraft | null = null;
      if (state.result.status === "found") {
        govDraft = state.result.vehicle;
        setGovMeta({ fetched_at: state.result.fetchedAt, resource_id: state.result.resourceId });
      } else {
        setGovMeta(null);
      }
      // Use the user-reviewed plate as the document's registration proposal.
      const ex = { ...extraction, registration_number: { ...extraction.registration_number, value: plate } };
      setGov(govDraft);
      setComparison(compareVehicleSources(ex, govDraft));
      setStep("review");
    });
  }

  // ---- Upload -------------------------------------------------------------
  if (step === "upload") {
    return (
      <div className="space-y-4">
        <BackButton onClick={onBack} label={tl("back")} />
        <form onSubmit={onUpload} className="space-y-3" noValidate>
          <div className="space-y-1.5">
            <Label htmlFor="reg-file">{ts("uploadLabel")}</Label>
            <input
              id="reg-file"
              name="file"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              capture="environment"
              className="block w-full text-sm text-ink-2 file:me-3 file:rounded-lg file:border-0 file:bg-accent file:px-4 file:py-2 file:text-sm file:font-medium file:text-on-accent"
            />
            <p className="text-xs text-ink-2">{ts("uploadHelp")}</p>
            <p className="text-xs text-ink-3">{ts("privacyNote")}</p>
          </div>
          {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}
          <Button type="submit" disabled={isPending}>{ts("extract")}</Button>
        </form>
      </div>
    );
  }

  // ---- Extracting / looking (progress) ------------------------------------
  if (step === "extracting" || step === "looking") {
    return (
      <div className="space-y-3" aria-live="polite">
        <p className="text-sm text-ink-2">{step === "extracting" ? ts("extracting") : tl("searching")}</p>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
          <div className="h-full w-1/3 animate-pulse rounded-full bg-accent" />
        </div>
      </div>
    );
  }

  // ---- Wrong document type ------------------------------------------------
  if (step === "wrongDoc") {
    return (
      <div className="space-y-4">
        <BackButton onClick={onBack} label={tl("back")} />
        <div className="space-y-3 rounded-xl border border-danger/30 bg-danger/8 p-4">
          <p className="text-sm text-ink">{ts("wrongDoc")}</p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={() => { setStep("upload"); setError(null); }}>
              {ts("replace")}
            </Button>
            <Button type="button" variant="outline" onClick={onBack}>{tl("continueManual")}</Button>
          </div>
        </div>
      </div>
    );
  }

  // ---- Plate review + government lookup ------------------------------------
  if (step === "plate" && extraction) {
    return (
      <div className="space-y-4">
        <BackButton onClick={onBack} label={tl("back")} />
        <div className="rounded-xl border border-accent/30 bg-accent/8 p-4 text-sm">
          <p className="font-semibold text-ink">{ts("extracted")}</p>
          {extraction.warnings.length > 0 ? (
            <p className="mt-1 text-xs text-ink-2">{ts("qualityWarning")}</p>
          ) : null}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="reg-plate">{tl("methods.registration")}</Label>
          <Input id="reg-plate" dir="ltr" className="num" inputMode="numeric" value={plate}
            onChange={(e) => setPlate(e.target.value)} />
          <p className="text-xs text-ink-2">{ts("plateHelp")}</p>
        </div>
        {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}
        <div className="flex flex-wrap gap-2">
          <Button type="button" disabled={isPending} onClick={() => runLookup(false)}>{tl("search")}</Button>
          <Button type="button" variant="outline" disabled={isPending} onClick={() => runLookup(true)}>
            {ts("skipLookup")}
          </Button>
        </div>
      </div>
    );
  }

  // ---- Combined Review ----------------------------------------------------
  if (step === "review" && comparison && intakeId) {
    const usedGovernment = gov != null;
    const boundConfirm = (values: VehicleFormValues): Promise<VehicleActionState> =>
      confirmRegistrationIntakeAction({
        intakeId,
        vehicle: {
          make: values.make,
          model: values.model,
          year: values.year,
          vin: values.vin,
          license_plate: values.license_plate,
          color: values.color,
          fuel_type: values.fuel_type,
          test_expiry_date: values.test_expiry_date,
        },
        usedGovernment,
        government: govMeta,
        createReminder,
        reminderLeadDays: 30,
      });
    return (
      <div className="space-y-4">
        <BackButton onClick={() => setStep("plate")} label={tl("back")} />
        <ComparisonBanner comparison={comparison} usedGovernment={usedGovernment} />
        <label className="flex items-center gap-2 text-sm text-ink-2">
          <input type="checkbox" checked={createReminder} onChange={(e) => setCreateReminder(e.target.checked)} />
          {ts("createReminder")}
        </label>
        <VehicleForm mode="create" action={boundConfirm} defaultValues={mergedDefaults(comparison)} cancelHref={cancelHref} />
      </div>
    );
  }

  return null;
}

function BackButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button type="button" onClick={onClick} className="text-sm font-medium text-accent hover:underline">
      ← {label}
    </button>
  );
}

function ComparisonBanner({
  comparison,
  usedGovernment,
}: {
  comparison: VehicleSourceComparison;
  usedGovernment: boolean;
}) {
  const ts = useTranslations("vehicles.scan");
  const conflicts = Object.values(comparison.fields).filter((f) => f.status === "conflict");
  return (
    <div className="space-y-2 rounded-xl border border-accent/30 bg-accent/8 p-4 text-sm">
      <p className="font-semibold text-ink">{ts("reviewTitle")}</p>
      <p className="text-xs text-ink-2">{ts("sourceDocument")}{usedGovernment ? ` · ${ts("sourceGovernment")}` : ""}</p>
      <p className="text-xs text-ink-2">{ts("notOwnership")}</p>
      {comparison.registrationConflict ? (
        <p role="alert" className="text-xs font-medium text-danger">{ts("registrationConflict")}</p>
      ) : null}
      {conflicts.length > 0 ? (
        <details className="mt-1">
          <summary className="cursor-pointer text-xs font-medium text-ink">{ts("conflictsSummary", { count: conflicts.length })}</summary>
          <ul className="mt-1 space-y-1 text-xs text-ink-2">
            {conflicts.map((f) => (
              <li key={f.field}>
                <span className="font-medium">{ts(`fields.${f.field}`)}</span>: {ts("sourceGovernment")} “{f.government}” · {ts("sourceDocument")} “{f.document}”
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

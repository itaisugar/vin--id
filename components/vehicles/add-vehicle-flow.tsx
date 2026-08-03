"use client";

import * as React from "react";
import { useTranslations, useFormatter } from "next-intl";
import {
  createVehicleAction,
  lookupVehicleAction,
  type VehicleActionState,
  type VehicleLookupActionState,
} from "@/app/(app)/vehicles/actions";
import { VehicleForm } from "@/components/vehicles/vehicle-form";
import { ScanRegistrationFlow } from "@/components/vehicles/scan-registration-flow";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { normalizeRegistration } from "@/lib/vehicle-lookup/normalize-registration";
import type {
  VehicleLookupDraft,
  VehicleLookupResult,
  VehicleLookupWarning,
} from "@/lib/vehicle-lookup/types";
import { EMPTY_VEHICLE_FORM, type VehicleFormValues } from "@/lib/vehicles/types";

/**
 * Add Vehicle — method selection, government lookup, and the editable Review
 * that reuses the shared VehicleForm. No vehicle is created during lookup; only
 * the final VehicleForm submission (confirmation) creates one, through the normal
 * server path. Manual entry is always reachable — before lookup, after a
 * not-found, after any provider failure, and via the review's back action.
 */

type Step = "choose" | "lookup" | "scan" | "review" | "manual";

function draftToFormValues(draft: VehicleLookupDraft): VehicleFormValues {
  return {
    ...EMPTY_VEHICLE_FORM,
    make: draft.make ?? "",
    model: draft.model ?? "",
    year: draft.year != null ? String(draft.year) : "",
    vin: draft.vin ?? "",
    license_plate: draft.registration_number ?? "",
    color: draft.color ?? "",
    fuel_type: draft.fuel_type ?? "",
    test_expiry_date: draft.test_expiry_date ?? "",
  };
}

export function AddVehicleFlow({
  cancelHref,
  initialMethod,
}: {
  cancelHref: string;
  /** Deep-link straight into a method (e.g. from onboarding); defaults to the chooser. */
  initialMethod?: "lookup" | "scan" | "manual";
}) {
  const tl = useTranslations("vehicles.lookup");
  const format = useFormatter();

  const [step, setStep] = React.useState<Step>(initialMethod ?? "choose");
  const [reg, setReg] = React.useState("");
  const [formatError, setFormatError] = React.useState<string | null>(null);
  const [lookup, setLookup] = React.useState<VehicleLookupActionState | null>(null);
  const [isPending, startTransition] = React.useTransition();

  // The normalized plate we carry into a manual fallback so the user need not
  // retype it. Only ever a validated digit string.
  const carriedPlate = React.useMemo(() => {
    const n = normalizeRegistration(reg);
    return n.ok ? n.digits : "";
  }, [reg]);

  function runLookup(e: React.FormEvent) {
    e.preventDefault();
    setFormatError(null);
    setLookup(null);
    const norm = normalizeRegistration(reg);
    if (!norm.ok) {
      setFormatError(tl(`format.${norm.reason}`));
      return;
    }
    startTransition(async () => {
      const state = await lookupVehicleAction(reg);
      setLookup(state);
      if (state.result.status === "found") setStep("review");
    });
  }

  // ---- Method selection -----------------------------------------------------
  if (step === "choose") {
    return (
      <div className="space-y-3">
        <button
          type="button"
          onClick={() => setStep("lookup")}
          className="flex w-full flex-col items-start gap-1 rounded-xl border border-line bg-surface-2/40 p-4 text-start transition hover:bg-surface-2"
        >
          <span className="font-semibold text-ink">{tl("methods.registration")}</span>
          <span className="text-sm text-ink-2">{tl("methods.registrationHelp")}</span>
        </button>
        <button
          type="button"
          onClick={() => setStep("scan")}
          className="flex w-full flex-col items-start gap-1 rounded-xl border border-line bg-surface-2/40 p-4 text-start transition hover:bg-surface-2"
        >
          <span className="font-semibold text-ink">{tl("methods.scan")}</span>
          <span className="text-sm text-ink-2">{tl("methods.scanHelp")}</span>
        </button>
        <button
          type="button"
          onClick={() => setStep("manual")}
          className="flex w-full flex-col items-start gap-1 rounded-xl border border-line bg-surface-2/40 p-4 text-start transition hover:bg-surface-2"
        >
          <span className="font-semibold text-ink">{tl("methods.manual")}</span>
          <span className="text-sm text-ink-2">{tl("methods.manualHelp")}</span>
        </button>
      </div>
    );
  }

  // ---- Scan registration document -------------------------------------------
  if (step === "scan") {
    return <ScanRegistrationFlow cancelHref={cancelHref} onBack={() => setStep("choose")} />;
  }

  // ---- Manual entry ---------------------------------------------------------
  if (step === "manual") {
    const defaults = carriedPlate
      ? { ...EMPTY_VEHICLE_FORM, license_plate: carriedPlate }
      : EMPTY_VEHICLE_FORM;
    return (
      <div className="space-y-4">
        <BackButton onClick={() => setStep("choose")} label={tl("back")} />
        <VehicleForm mode="create" action={createVehicleAction} defaultValues={defaults} cancelHref={cancelHref} />
      </div>
    );
  }

  // ---- Review (found) -------------------------------------------------------
  if (step === "review" && lookup?.result.status === "found") {
    const { result } = lookup;
    const boundCreate = (values: VehicleFormValues): Promise<VehicleActionState> =>
      createVehicleAction(values, {
        source: "israel_government",
        fetchedAt: result.fetchedAt,
      });
    return (
      <div className="space-y-4">
        <BackButton onClick={() => setStep("lookup")} label={tl("back")} />
        <ReviewBanner
          result={result}
          duplicate={lookup.duplicate ?? null}
          fetchedAtLabel={format.dateTime(new Date(result.fetchedAt), { dateStyle: "medium", timeStyle: "short" })}
        />
        <VehicleForm
          mode="create"
          action={boundCreate}
          defaultValues={draftToFormValues(result.vehicle)}
          cancelHref={cancelHref}
        />
      </div>
    );
  }

  // ---- Lookup input (and not-found / unavailable states) --------------------
  const status = lookup?.result.status;
  return (
    <div className="space-y-4">
      <BackButton onClick={() => setStep("choose")} label={tl("back")} />
      <form onSubmit={runLookup} className="space-y-3" noValidate>
        <div className="space-y-1.5">
          <Label htmlFor="registration">{tl("methods.registration")}</Label>
          <Input
            id="registration"
            inputMode="numeric"
            dir="ltr"
            className="num"
            autoComplete="off"
            placeholder={tl("inputPlaceholder")}
            value={reg}
            onChange={(e) => setReg(e.target.value)}
            disabled={isPending}
            aria-invalid={Boolean(formatError)}
            aria-describedby={formatError ? "registration-error" : "registration-help"}
          />
          {formatError ? (
            <p id="registration-error" className="text-sm text-danger">{formatError}</p>
          ) : (
            <p id="registration-help" className="text-sm text-ink-2">{tl("methods.registrationHelp")}</p>
          )}
        </div>

        <div className="flex gap-2">
          <Button type="submit" disabled={isPending || reg.trim() === ""}>
            {isPending ? tl("searching") : tl("search")}
          </Button>
        </div>
      </form>

      {/* Non-found outcomes: always keep manual entry available. */}
      <div aria-live="polite">
        {status === "not_found" ? (
          <OutcomeCard message={tl("notFound")} onManual={() => setStep("manual")} manualLabel={tl("continueManual")} />
        ) : null}
        {status === "unavailable" ? (
          <OutcomeCard
            message={tl(`unavailable.${(lookup!.result as { reason: string }).reason}`)}
            onManual={() => setStep("manual")}
            manualLabel={tl("continueManual")}
          />
        ) : null}
        {status === "invalid_registration_number" ? (
          <OutcomeCard message={tl("format.non_numeric")} onManual={() => setStep("manual")} manualLabel={tl("continueManual")} />
        ) : null}
      </div>
    </div>
  );
}

function BackButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button type="button" onClick={onClick} className="text-sm font-medium text-accent hover:underline">
      ← {label}
    </button>
  );
}

function OutcomeCard({
  message,
  onManual,
  manualLabel,
}: {
  message: string;
  onManual: () => void;
  manualLabel: string;
}) {
  return (
    <div className="space-y-3 rounded-xl border border-line bg-surface-2/40 p-4">
      <p className="text-sm text-ink-2">{message}</p>
      <Button type="button" variant="outline" onClick={onManual}>
        {manualLabel}
      </Button>
    </div>
  );
}

const WARNING_KEYS: Record<VehicleLookupWarning, string> = {
  registration_number_had_leading_zero: "leadingZero",
  model_is_coded: "codedModel",
  test_expiry_unparseable: "expiryUnparseable",
  test_expiry_passed: "expiryPassed",
  partial_data: "partial",
};

function ReviewBanner({
  result,
  duplicate,
  fetchedAtLabel,
}: {
  result: Extract<VehicleLookupResult, { status: "found" }>;
  duplicate: { id: string; make: string | null; model: string | null } | null;
  fetchedAtLabel: string;
}) {
  const tl = useTranslations("vehicles.lookup");
  return (
    <div className="space-y-2 rounded-xl border border-accent/30 bg-accent/8 p-4">
      <p className="text-sm font-semibold text-ink">{tl("sourceLabel")}</p>
      <p className="text-xs text-ink-2">{tl("fetchedAt", { time: fetchedAtLabel })}</p>
      <p className="text-xs text-ink-2">{tl("notOwnership")}</p>

      {result.warnings.length > 0 ? (
        <ul className="mt-1 list-disc space-y-1 ps-5 text-xs text-ink-2">
          {result.warnings.map((w) => (
            <li key={w}>{tl(`warnings.${WARNING_KEYS[w]}`)}</li>
          ))}
        </ul>
      ) : null}

      {duplicate ? (
        <p role="alert" className="mt-1 text-xs font-medium text-danger">
          {tl("duplicateWarning")}{" "}
          <a href={`/vehicles/${duplicate.id}`} className="underline">
            {tl("openExisting")}
          </a>
        </p>
      ) : null}
    </div>
  );
}

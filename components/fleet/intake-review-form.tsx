"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  cancelIntakeAction,
  confirmIntakeAction,
} from "@/app/(app)/fleet-intake/actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  categoryConfidenceLevel,
  INTAKE_CATEGORIES,
  requiresManualVehicleSelection,
  type IntakeCategory,
  type IntakeRecord,
} from "@/lib/fleet-intake/types";

/**
 * Extraction field names differ from form field names in three places. Kept
 * here so the "read from document" line under each input compares like with
 * like instead of always reporting "nothing found".
 */
function suggestionKeyFor(name: string): string {
  if (name === "performed_at") return "date";
  if (name === "vendor_name") return "garage_name";
  if (name === "description") return "service_details";
  return name;
}

export interface IntakeVehicleOption {
  id: string;
  label: string;
  licensePlate: string | null;
}

/**
 * The review screen: AI suggestion on the left of every field, the value that
 * will actually be saved in the input beside it.
 *
 * NOTHING HERE HAS BEEN SAVED. The intake row exists so the review survives a
 * refresh, but no maintenance/insurance/registration/inspection record is
 * created until the user presses Confirm, which is deliberately the only
 * primary button on the screen. Cancel and Retry sit apart from it.
 */
export function IntakeReviewForm({
  intake,
  vehicles,
  duplicateCount,
}: {
  intake: IntakeRecord;
  vehicles: IntakeVehicleOption[];
  duplicateCount: number;
}) {
  const t = useTranslations("fleet.intake");
  const tErrors = useTranslations("fleet.intake.errors");
  const router = useRouter();

  const extracted = (intake.extracted_data ?? {}) as Record<string, unknown>;
  const str = (key: string) => {
    const v = extracted[key];
    return v == null ? "" : String(v);
  };

  const proposed = intake.proposed_category;
  const confidenceLevel = categoryConfidenceLevel(
    intake.category_confidence,
    proposed,
  );

  // A low-confidence or unknown classification must NOT arrive pre-selected:
  // the user picks it, so a wrong guess cannot be confirmed by reflex.
  const [category, setCategory] = React.useState<IntakeCategory | "">(
    confidenceLevel === "manual" ||
      !INTAKE_CATEGORIES.includes(proposed as IntakeCategory)
      ? ""
      : (proposed as IntakeCategory),
  );

  const mustChooseVehicle = requiresManualVehicleSelection(
    intake.vehicle_match_method,
    intake.vehicle_candidates?.length ?? 0,
  );
  const [vehicleId, setVehicleId] = React.useState(
    mustChooseVehicle ? "" : (intake.vehicle_id ?? ""),
  );

  const [values, setValues] = React.useState({
    performed_at: str("date"),
    start_date: str("start_date"),
    end_date: str("end_date"),
    mileage: str("mileage"),
    cost: str("cost"),
    currency: "ILS",
    vendor_name: str("garage_name"),
    insurer_name: str("insurer_name"),
    insurance_type: str("insurance_type"),
    service_type: str("service_type"),
    description: str("service_details"),
    notes: str("notes"),
    next_service_date: str("next_service_date"),
    next_service_km: str("next_service_km"),
  });
  const set = (key: keyof typeof values) => (v: string) =>
    setValues((prev) => ({ ...prev, [key]: v }));

  const [error, setError] = React.useState<string | null>(null);
  const [isPending, startTransition] = React.useTransition();
  // Guards a double-click in the window before the server responds. The RPC is
  // idempotent regardless — this only avoids a pointless second round trip.
  const submitted = React.useRef(false);

  function onConfirm() {
    if (submitted.current) return;
    setError(null);
    if (!vehicleId) return setError(tErrors("vehicleRequired"));
    if (!category) return setError(tErrors("categoryRequired"));

    submitted.current = true;
    const formData = new FormData();
    formData.set("extractionId", intake.id);
    formData.set("vehicleId", vehicleId);
    formData.set("category", category);
    for (const [k, v] of Object.entries(values)) formData.set(k, v);

    startTransition(async () => {
      const state = await confirmIntakeAction({ ok: false, error: "saveFailed" }, formData);
      if (state.ok) {
        router.push(`/vehicles/${state.vehicleId}`);
        return;
      }
      submitted.current = false;
      setError(tErrors(state.error));
    });
  }

  function onCancel() {
    startTransition(async () => {
      await cancelIntakeAction(intake.id);
      router.push("/dashboard");
    });
  }

  /**
   * One field: the AI's proposal shown beneath the editable value.
   *
   * A plain render helper rather than a nested component — a component defined
   * during render is a new type on every keystroke, so React would unmount and
   * remount the input and the caret would jump out of it after each character.
   */
  const field = (
    name: keyof typeof values,
    label: string,
    type = "text",
  ) => {
    const suggestion = str(suggestionKeyFor(name));
    const changed = suggestion !== "" && suggestion !== values[name];
    return (
      <div className="space-y-1.5">
        <Label htmlFor={`f-${name}`}>{label}</Label>
        <Input
          id={`f-${name}`}
          type={type}
          value={values[name]}
          onChange={(e) => set(name)(e.target.value)}
        />
        {suggestion ? (
          <p className="text-xs text-ink-3">
            {t("aiSuggested", { value: suggestion })}
            {changed ? ` · ${t("youChanged")}` : ""}
          </p>
        ) : (
          <p className="text-xs text-ink-3">{t("aiFoundNothing")}</p>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-5">
      {/* Warnings, most consequential first. */}
      {duplicateCount > 0 ? (
        <p className="rounded-xl border border-warn/25 bg-warn/10 p-3 text-sm text-warn">
          {t("duplicateWarning", { count: duplicateCount })}
        </p>
      ) : null}
      {intake.vehicle_match_method === "conflict" ? (
        <p className="rounded-xl border border-danger/25 bg-danger/10 p-3 text-sm text-danger">
          {t("vehicleConflict")}
        </p>
      ) : null}
      {confidenceLevel === "manual" ? (
        <p className="rounded-xl border border-warn/25 bg-warn/10 p-3 text-sm text-warn">
          {t("lowConfidence")}
        </p>
      ) : confidenceLevel === "review" ? (
        <p className="rounded-xl border border-line bg-surface-2 p-3 text-sm text-ink-2">
          {t("checkCategory")}
        </p>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("vehicleSection")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 p-4 pt-0">
          {str("vehicle_registration") || str("vin") ? (
            <p className="text-xs text-ink-3">
              {t("identifiersFound", {
                registration: str("vehicle_registration") || "—",
                vin: str("vin") || "—",
              })}
            </p>
          ) : (
            <p className="text-xs text-ink-3">{t("noIdentifiers")}</p>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="intake-vehicle">{t("vehicleLabel")}</Label>
            <Select
              id="intake-vehicle"
              value={vehicleId}
              onChange={(e) => setVehicleId(e.target.value)}
            >
              <option value="">{t("chooseVehicle")}</option>
              {vehicles.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.licensePlate ? `${v.licensePlate} — ${v.label}` : v.label}
                </option>
              ))}
            </Select>
            {mustChooseVehicle ? (
              <p className="text-xs text-warn">{t("mustChooseVehicle")}</p>
            ) : null}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("detailsSection")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 p-4 pt-0">
          <div className="space-y-1.5">
            <Label htmlFor="intake-category">{t("categoryLabel")}</Label>
            <Select
              id="intake-category"
              value={category}
              onChange={(e) => setCategory(e.target.value as IntakeCategory)}
            >
              <option value="">{t("chooseCategory")}</option>
              {INTAKE_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {t(`categories.${c}`)}
                </option>
              ))}
            </Select>
          </div>

          {category === "maintenance" ? (
            <>
              {field("performed_at", t("fields.date"), "date")}
              {field("vendor_name", t("fields.garage"))}
              {field("service_type", t("fields.serviceType"))}
              <div className="space-y-1.5">
                <Label htmlFor="f-description">{t("fields.description")}</Label>
                <Textarea
                  id="f-description"
                  rows={3}
                  value={values.description}
                  onChange={(e) => set("description")(e.target.value)}
                />
              </div>
              {field("mileage", t("fields.mileage"), "number")}
              {field("cost", t("fields.cost"), "number")}
              {field("next_service_date", t("fields.nextServiceDate"), "date")}
              {field("next_service_km", t("fields.nextServiceKm"), "number")}
            </>
          ) : null}

          {category === "insurance" ? (
            <>
              {field("insurer_name", t("fields.insurer"))}
              {field("insurance_type", t("fields.insuranceType"))}
              {field("start_date", t("fields.startDate"), "date")}
              {field("end_date", t("fields.endDate"), "date")}
              {field("cost", t("fields.cost"), "number")}
            </>
          ) : null}

          {category === "registration" || category === "inspection" ? (
            <>
              {field("start_date", t("fields.startDate"), "date")}
              {field("end_date", t("fields.endDate"), "date")}
              {field("mileage", t("fields.mileage"), "number")}
              {category === "inspection"
                ? field("cost", t("fields.cost"), "number")
                : null}
              <div className="space-y-1.5">
                <Label htmlFor="f-notes">{t("fields.notes")}</Label>
                <Textarea
                  id="f-notes"
                  rows={3}
                  value={values.notes}
                  onChange={(e) => set("notes")(e.target.value)}
                />
              </div>
            </>
          ) : null}
        </CardContent>
      </Card>

      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}

      {/* Confirm is the only primary action, and is visually separated from the
          non-destructive ones so it can never be pressed by momentum. */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
        <div className="flex gap-2">
          <Button type="button" variant="ghost" disabled={isPending} onClick={onCancel}>
            {t("cancel")}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={isPending}
            onClick={() => router.push("/fleet-intake")}
          >
            {t("retry")}
          </Button>
        </div>
        <Button type="button" disabled={isPending || !vehicleId || !category} onClick={onConfirm}>
          {isPending ? t("confirming") : t("confirm")}
        </Button>
      </div>
      <p className="text-xs text-ink-3">{t("nothingSavedYet")}</p>
    </div>
  );
}

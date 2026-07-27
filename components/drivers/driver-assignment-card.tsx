"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import {
  assignDriverAction,
  unassignDriverAction,
} from "@/app/(app)/vehicles/[id]/assignment-actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import type {
  AssignmentHistoryEntry,
  CurrentAssignment,
  EligibleDriver,
} from "@/lib/drivers/types";

/**
 * Assign / replace / unassign the vehicle's driver.
 *
 * Rendered only for owner/admin/fleet_manager. That is a UI convenience, not the
 * boundary: both actions re-check the role server-side and the RPCs check it
 * again against `can_manage_driver_assignments()`.
 *
 * There is no separate "replace" control, because assigning IS the replace:
 * `assign_driver()` closes the vehicle's current assignment and the incoming
 * driver's current assignment in the same transaction before inserting.
 */
export function DriverAssignmentCard({
  vehicleId,
  current,
  eligible,
  history,
}: {
  vehicleId: string;
  current: CurrentAssignment | null;
  eligible: EligibleDriver[];
  history: AssignmentHistoryEntry[];
}) {
  const t = useTranslations("driver.assignment");
  const tErrors = useTranslations("driver.errors");

  const [memberId, setMemberId] = React.useState("");
  const [note, setNote] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [isPending, startTransition] = React.useTransition();

  const selected = eligible.find((d) => d.member_id === memberId);
  // Assigning someone who already drives another vehicle silently moves them.
  // Say so before it happens rather than after.
  const willMove =
    selected?.assigned_vehicle_id != null &&
    selected.assigned_vehicle_id !== vehicleId;

  function submit(
    action: typeof assignDriverAction | typeof unassignDriverAction,
    extra?: Record<string, string>,
  ) {
    setError(null);
    const formData = new FormData();
    formData.set("vehicleId", vehicleId);
    for (const [k, v] of Object.entries(extra ?? {})) formData.set(k, v);

    startTransition(async () => {
      const state = await action({}, formData);
      if (state.error) setError(tErrors(state.error));
      else {
        setMemberId("");
        setNote("");
      }
    });
  }

  const pastEntries = history.filter((entry) => entry.unassigned_at !== null);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t("title")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 p-4 pt-0">
        {/* Current assignment */}
        {current ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-surface-2 p-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">
                {current.driver_name ?? current.driver_email ?? t("unnamed")}
              </p>
              <p className="text-xs text-ink-3">{current.driver_email}</p>
            </div>
            <Button
              type="button"
              variant="outline"
              disabled={isPending}
              onClick={() => submit(unassignDriverAction)}
            >
              {t("unassign")}
            </Button>
          </div>
        ) : (
          <p className="text-sm text-ink-2">{t("none")}</p>
        )}

        {/* Assign / replace */}
        {eligible.length === 0 ? (
          <p className="text-sm text-ink-2">{t("noEligibleDrivers")}</p>
        ) : (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="assign-driver">
                {current ? t("replaceLabel") : t("assignLabel")}
              </Label>
              <Select
                id="assign-driver"
                value={memberId}
                onChange={(event) => setMemberId(event.target.value)}
              >
                <option value="">{t("choose")}</option>
                {eligible.map((driver) => (
                  <option key={driver.member_id} value={driver.member_id}>
                    {driver.full_name ?? driver.email ?? t("unnamed")}
                  </option>
                ))}
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="assign-note">{t("noteLabel")}</Label>
              <Input
                id="assign-note"
                value={note}
                maxLength={200}
                onChange={(event) => setNote(event.target.value)}
                placeholder={t("notePlaceholder")}
              />
              <p className="text-xs text-ink-3">{t("noteHelp")}</p>
            </div>

            {willMove ? (
              <p className="rounded-xl border border-warn/25 bg-warn/10 p-3 text-xs text-warn">
                {t("willMove")}
              </p>
            ) : null}

            <Button
              type="button"
              disabled={isPending || !memberId}
              onClick={() => submit(assignDriverAction, { memberId, note })}
            >
              {current ? t("replace") : t("assign")}
            </Button>
          </div>
        )}

        {error ? (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        ) : null}

        {/* History */}
        {pastEntries.length > 0 ? (
          <details className="rounded-xl border border-line p-3">
            <summary className="cursor-pointer text-sm font-medium">
              {t("history")}
            </summary>
            <ul className="mt-2 space-y-2">
              {pastEntries.map((entry) => (
                <li key={entry.id} className="text-xs text-ink-2">
                  {entry.driver_name ?? entry.driver_email ?? t("unnamed")} ·{" "}
                  {entry.assigned_at.slice(0, 10)} →{" "}
                  {entry.unassigned_at?.slice(0, 10)}
                  {entry.note ? ` · ${entry.note}` : ""}
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </CardContent>
    </Card>
  );
}

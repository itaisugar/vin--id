"use client";

import { useTranslations } from "next-intl";
import { useId, useState, useTransition } from "react";
import { setVehicleStatusAction } from "@/app/(app)/vehicles/actions";
import { Select } from "@/components/ui/select";
import { OPERATIONAL_STATUSES, type OperationalStatus } from "@/lib/fleet/types";

/**
 * Quick operational-status control on the vehicle page.
 *
 * Rendered only for roles that may write (owner / admin / fleet_manager) —
 * a viewer gets the read-only badge instead. That is a UI affordance, not the
 * security boundary: the server action calls `requireFleetWriter()` and RLS
 * independently requires `public.is_org_writer()`.
 *
 * No `useEffect`: the local value is seeded from the prop and updated in the
 * change handler, so there is no effect-driven state sync (which the project's
 * lint config forbids).
 */
export function VehicleStatusControl({
  vehicleId,
  status,
}: {
  vehicleId: string;
  status: OperationalStatus;
}) {
  const t = useTranslations("fleet");
  const id = useId();
  const [value, setValue] = useState<OperationalStatus>(status);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  return (
    <div className="space-y-1.5">
      <label
        htmlFor={id}
        className="block text-[11px] uppercase tracking-[0.14em] text-ink-3"
      >
        {t("fields.operationalStatus")}
      </label>
      <Select
        id={id}
        value={value}
        disabled={isPending}
        aria-describedby={error ? `${id}-error` : undefined}
        onChange={(e) => {
          const next = e.target.value as OperationalStatus;
          const previous = value;
          setValue(next);
          setError(null);

          startTransition(async () => {
            const result = await setVehicleStatusAction(vehicleId, next);
            if (result?.error) {
              setValue(previous); // roll back the optimistic change
              setError(result.error);
            }
          });
        }}
      >
        {OPERATIONAL_STATUSES.map((s) => (
          <option key={s} value={s}>
            {t(`status.${s}`)}
          </option>
        ))}
      </Select>
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-xs text-danger">
          {t(`errors.${error}`)}
        </p>
      ) : null}
    </div>
  );
}

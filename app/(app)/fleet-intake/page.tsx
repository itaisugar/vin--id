import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { IntakeUploadForm } from "@/components/fleet/intake-upload-form";
import { redirectDriversAway } from "@/lib/drivers/guard";
import { getCurrentRole } from "@/lib/organizations/service";
import { canWriteFleetData } from "@/lib/organizations/types";
import { listVehicles } from "@/lib/vehicles/service";

/**
 * Fleet document intake — upload entry point.
 *
 * Writers only. A viewer is redirected rather than shown a form whose every
 * action the server would reject; a driver is sent to their own screen. Neither
 * redirect is the security boundary — `requireFleetWriter()` in the action and
 * `is_org_writer()` in the database are.
 */
export default async function FleetIntakePage({
  searchParams,
}: PageProps<"/fleet-intake">) {
  await redirectDriversAway();

  const role = await getCurrentRole();
  if (!role || !canWriteFleetData(role)) redirect("/dashboard");

  const t = await getTranslations("fleet.intake");
  const { vehicle } = await searchParams;

  const vehicles = await listVehicles();
  const options = vehicles
    .filter((v) => v.status === "active")
    .map((v) => ({
      id: v.id,
      label: [v.make, v.model].filter(Boolean).join(" ").trim() || v.id.slice(0, 8),
      licensePlate: v.license_plate,
    }));

  const preset = typeof vehicle === "string" ? vehicle : undefined;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-extrabold tracking-tight">{t("title")}</h1>
        <p className="text-sm text-ink-2">{t("subtitle")}</p>
      </div>

      {options.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-line p-12 text-center">
          <p className="font-medium">{t("noVehicles")}</p>
        </div>
      ) : (
        <IntakeUploadForm vehicles={options} presetVehicleId={preset} />
      )}
    </div>
  );
}

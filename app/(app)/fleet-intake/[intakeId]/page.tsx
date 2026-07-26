import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { IntakeReviewForm } from "@/components/fleet/intake-review-form";
import { redirectDriversAway } from "@/lib/drivers/guard";
import { findDuplicateDocuments, getIntake } from "@/lib/fleet-intake/service";
import { getCurrentRole } from "@/lib/organizations/service";
import { canWriteFleetData } from "@/lib/organizations/types";
import { listVehicles } from "@/lib/vehicles/service";

/**
 * Fleet document intake — review and confirm.
 *
 * Reaching this page changes nothing. The intake row it renders is a proposal;
 * the fleet's data is untouched until the user presses Confirm, which is the
 * only control that calls `confirm_fleet_intake()`.
 */
export default async function IntakeReviewPage({
  params,
}: PageProps<"/fleet-intake/[intakeId]">) {
  await redirectDriversAway();

  const role = await getCurrentRole();
  if (!role || !canWriteFleetData(role)) redirect("/dashboard");

  const { intakeId } = await params;
  const t = await getTranslations("fleet.intake");

  const intake = await getIntake(intakeId);
  if (!intake) notFound();

  // An already-confirmed intake is not re-reviewable: send the user to the
  // record it produced instead of offering a second confirmation.
  if (intake.status === "confirmed" && intake.vehicle_id) {
    redirect(`/vehicles/${intake.vehicle_id}`);
  }

  if (intake.status === "failed") {
    return (
      <div className="mx-auto max-w-2xl space-y-6">
        <h1 className="text-2xl font-extrabold tracking-tight">{t("title")}</h1>
        <div className="space-y-3 rounded-2xl border border-danger/25 bg-danger/10 p-6">
          <p className="font-medium text-danger">{t("extractionFailed")}</p>
          <p className="text-sm text-ink-2">{t("extractionFailedBody")}</p>
          <Link
            href="/fleet-intake"
            className="inline-flex rounded-xl border border-line px-3 py-1.5 text-sm font-medium"
          >
            {t("retry")}
          </Link>
        </div>
      </div>
    );
  }

  if (intake.status !== "pending_confirmation") {
    return (
      <div className="mx-auto max-w-2xl space-y-4">
        <h1 className="text-2xl font-extrabold tracking-tight">{t("title")}</h1>
        <p className="rounded-2xl border border-line bg-surface-2 p-6 text-sm text-ink-2">
          {t("noLongerAvailable")}
        </p>
        <Link href="/fleet-intake" className="text-sm text-accent">
          {t("startOver")}
        </Link>
      </div>
    );
  }

  const vehicles = await listVehicles();
  const options = vehicles
    .filter((v) => v.status === "active")
    .map((v) => ({
      id: v.id,
      label: [v.make, v.model].filter(Boolean).join(" ").trim() || v.id.slice(0, 8),
      licensePlate: v.license_plate,
    }));

  // Re-checked here rather than trusted from the upload step, so the warning
  // still appears if the user returns to the review later.
  const contentHash = (intake as { content_hash?: string }).content_hash;
  const duplicates = contentHash ? await findDuplicateDocuments(contentHash) : [];
  const otherDuplicates = duplicates.filter(
    (d) => d.document_id !== intake.document_id,
  );

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-extrabold tracking-tight">{t("reviewTitle")}</h1>
        <p className="text-sm text-ink-2">{t("reviewSubtitle")}</p>
      </div>

      <IntakeReviewForm
        intake={intake}
        vehicles={options}
        duplicateCount={otherDuplicates.length}
      />
    </div>
  );
}

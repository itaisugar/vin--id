import Link from "next/link";
import { getTranslations } from "next-intl/server";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { effectiveStatus } from "@/lib/passports/types";
import type { PassportListItem } from "@/lib/passports/service";

/**
 * Vehicle Passport on the vehicle detail page: ONE contextual action.
 *
 * The page used to render up to three recent passport cards plus a "view all"
 * link, which turned an occasional action (share this vehicle's history with a
 * buyer) into a history feed nobody asked for. Production QA asked for a single
 * action instead.
 *
 * WHAT COUNTS AS CURRENT. `effectiveStatus()` from the passport module — the
 * same helper the passport list and detail screens use, so the three can never
 * disagree. It downgrades an `active` passport whose `expires_at` has passed to
 * `expired`, which means a lapsed passport correctly offers "Create" rather than
 * "Open". `revoked`, `accepted` and `draft` are likewise not current.
 *
 * NOTHING IS DELETED. Every passport row is still stored, still returned by
 * `listPassports()`, and still reachable at /vehicles/[id]/passports — the link
 * below is kept precisely so no history becomes unreachable. This component
 * only decides what the vehicle page leads with.
 */
export async function PassportSection({
  vehicleId,
  passports,
}: {
  vehicleId: string;
  passports: PassportListItem[];
}) {
  const t = await getTranslations("passports");

  // Newest first is guaranteed by listPassports' ORDER BY created_at DESC, so
  // the first match is the current one.
  const current = passports.find((p) => effectiveStatus(p) === "active") ?? null;

  return (
    <Card>
      <CardHeader className="space-y-0.5">
        <CardTitle>{t("title")}</CardTitle>
        <p className="text-xs text-ink-2">{t("subtitle")}</p>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-ink-2">
          {current ? t("section.currentBody") : t("section.noneBody")}
        </p>

        <div className="flex flex-wrap items-center gap-3">
          {current ? (
            <Link
              href={`/vehicles/${vehicleId}/passports/${current.id}`}
              className="inline-flex h-11 items-center justify-center rounded-xl bg-accent px-4 text-sm font-bold text-on-accent glow-accent"
            >
              {t("section.open")}
            </Link>
          ) : (
            <Link
              href={`/vehicles/${vehicleId}/passports/new`}
              className="inline-flex h-11 items-center justify-center rounded-xl bg-accent px-4 text-sm font-bold text-on-accent glow-accent"
            >
              {t("section.create")}
            </Link>
          )}

          {/* History stays reachable — it is de-emphasised, not removed. */}
          {passports.length > 0 ? (
            <Link
              href={`/vehicles/${vehicleId}/passports`}
              className="text-sm font-medium text-ink-2 underline hover:text-ink"
            >
              {t("section.history", { count: passports.length })}
            </Link>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

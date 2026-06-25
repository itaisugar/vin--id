import Link from "next/link";
import { getTranslations } from "next-intl/server";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { PassportCard } from "@/components/passports/passport-card";
import type { PassportListItem } from "@/lib/passports/service";

const RECENT_LIMIT = 3;

/** Vehicle Passport summary shown on the vehicle detail page. */
export async function PassportSection({
  vehicleId,
  passports,
}: {
  vehicleId: string;
  passports: PassportListItem[];
}) {
  const t = await getTranslations("passports");
  const recent = passports.slice(0, RECENT_LIMIT);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
        <div className="space-y-0.5">
          <CardTitle>{t("title")}</CardTitle>
          <p className="text-xs text-ink-2">{t("subtitle")}</p>
        </div>
        <Link
          href={`/vehicles/${vehicleId}/passports/new`}
          className="inline-flex h-9 shrink-0 items-center justify-center rounded-md bg-accent px-3 text-sm font-medium text-on-accent transition-colors hover:opacity-90"
        >
          {t("create.cta")}
        </Link>
      </CardHeader>
      <CardContent className="space-y-3">
        {recent.length === 0 ? (
          <p className="rounded-md border border-dashed border-line p-6 text-center text-sm text-ink-2">
            {t("empty.body")}
          </p>
        ) : (
          <>
            <div className="grid gap-3">
              {recent.map((passport) => (
                <PassportCard
                  key={passport.id}
                  vehicleId={vehicleId}
                  passport={passport}
                />
              ))}
            </div>
            {passports.length > RECENT_LIMIT ? (
              <Link
                href={`/vehicles/${vehicleId}/passports`}
                className="inline-block text-sm font-medium text-accent hover:underline"
              >
                {t("viewAll", { count: passports.length })}
              </Link>
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  );
}

"use client";

import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { Card } from "@/components/ui/card";
import { PassportStatusBadge } from "@/components/passports/passport-status-badge";
import type { PassportListItem } from "@/lib/passports/service";
import { effectiveStatus } from "@/lib/passports/types";

export function PassportCard({
  vehicleId,
  passport,
}: {
  vehicleId: string;
  passport: PassportListItem;
}) {
  const t = useTranslations("passports");
  const locale = useLocale();

  const status = effectiveStatus(passport);
  const created = new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(
    new Date(passport.created_at),
  );
  const expires = passport.expires_at
    ? new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(
        new Date(passport.expires_at),
      )
    : null;

  return (
    <Link
      href={`/vehicles/${vehicleId}/passports/${passport.id}`}
      className="block rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
    >
      <Card className="flex items-center justify-between gap-3 p-4 transition-colors hover:bg-surface-2">
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex items-center gap-2">
            <PassportStatusBadge status={status} />
            <span className="text-sm font-medium">
              {t("card.created")}: {created}
            </span>
          </div>
          <p className="text-xs text-ink-2">
            {expires ? `${t("card.expires")}: ${expires} · ` : ""}
            {t("confidence.short")}: {passport.record_confidence_score ?? 0}/100
          </p>
        </div>
        <span aria-hidden className="text-ink-2">
          →
        </span>
      </Card>
    </Link>
  );
}

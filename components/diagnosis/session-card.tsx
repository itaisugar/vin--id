"use client";

import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import type { DiagnosisSessionListItem } from "@/lib/diagnosis/service";

export function SessionCard({
  session,
}: {
  session: DiagnosisSessionListItem;
}) {
  const t = useTranslations("diagnose");
  const locale = useLocale();

  const vehicleName =
    [session.vehicle?.make, session.vehicle?.model]
      .filter(Boolean)
      .join(" ")
      .trim() || t("history.untitledVehicle");

  const created = new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(
    new Date(session.created_at),
  );

  return (
    <Link
      href={`/diagnose/${session.id}`}
      className="block rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
    >
      <Card className="flex items-center justify-between gap-3 p-4 transition-colors hover:bg-muted">
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium">{vehicleName}</span>
            <Badge tone={session.status === "active" ? "neutral" : "muted"}>
              {t(`status.${session.status}`)}
            </Badge>
          </div>
          <p className="truncate text-xs text-muted-foreground">
            {session.title || session.summary || ""}
          </p>
          <p className="text-xs text-muted-foreground">{created}</p>
        </div>
        <span aria-hidden className="text-muted-foreground">
          →
        </span>
      </Card>
    </Link>
  );
}

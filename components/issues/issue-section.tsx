import Link from "next/link";
import { getTranslations } from "next-intl/server";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { IssueListItem } from "@/components/issues/issue-list-item";
import type { IssueLog } from "@/lib/issues/types";
import type { MileageUnit } from "@/lib/vehicles/types";

const RECENT_LIMIT = 3;

/** Issues summary shown on the vehicle detail page. */
export async function IssueSection({
  vehicleId,
  issues,
  mileageUnit,
}: {
  vehicleId: string;
  issues: IssueLog[];
  mileageUnit: MileageUnit;
}) {
  const t = await getTranslations("issues");
  const recent = issues.slice(0, RECENT_LIMIT);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
        <CardTitle>{t("title")}</CardTitle>
        <Link
          href={`/vehicles/${vehicleId}/issues/new`}
          className="inline-flex h-9 shrink-0 items-center justify-center rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground transition-colors hover:opacity-90"
        >
          {t("addIssue")}
        </Link>
      </CardHeader>
      <CardContent className="space-y-3">
        {recent.length === 0 ? (
          <p className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            {t("empty.body")}
          </p>
        ) : (
          <>
            <div className="grid gap-3">
              {recent.map((issue) => (
                <IssueListItem
                  key={issue.id}
                  vehicleId={vehicleId}
                  issue={issue}
                  mileageUnit={mileageUnit}
                />
              ))}
            </div>
            <Link
              href={`/vehicles/${vehicleId}/issues`}
              className="inline-block text-sm font-medium text-primary hover:underline"
            >
              {t("viewAll", { count: issues.length })}
            </Link>
          </>
        )}
      </CardContent>
    </Card>
  );
}

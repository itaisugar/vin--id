import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

/** Record Confidence Score gauge. Documentation quality — NOT condition. */
export function ConfidenceScore({ score }: { score: number | null }) {
  const t = useTranslations("passports");
  const value = score ?? 0;

  const barTone =
    value >= 70 ? "bg-emerald-500" : value >= 40 ? "bg-amber-500" : "bg-red-500";

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between">
        <span className="text-sm font-medium">{t("confidence.title")}</span>
        <span className="text-2xl font-bold tabular-nums">
          {value}
          <span className="text-sm font-normal text-muted-foreground">/100</span>
        </span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
        <div
          className={cn("h-full rounded-full transition-all", barTone)}
          style={{ width: `${value}%` }}
        />
      </div>
      <p className="text-xs text-muted-foreground">{t("confidenceHelp")}</p>
    </div>
  );
}

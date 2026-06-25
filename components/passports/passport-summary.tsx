import { useTranslations } from "next-intl";
import type { PassportSummary } from "@/lib/passports/types";

const GROUPS = [
  { key: "strengths", field: "strengths" },
  { key: "attention_points", field: "attention_points" },
  { key: "recommended_checks", field: "recommended_checks" },
  { key: "missing_or_not_shared", field: "missing_or_not_shared" },
] as const;

/** Renders the deterministic summary codes as cautious, translated text. */
export function PassportSummaryView({ summary }: { summary: PassportSummary }) {
  const t = useTranslations("passports");

  const hasAny = GROUPS.some((g) => (summary[g.field] ?? []).length > 0);
  if (!hasAny) {
    return (
      <p className="text-sm text-ink-2">{t("summary.none")}</p>
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {GROUPS.map(({ key, field }) => {
        const items = summary[field] ?? [];
        if (items.length === 0) return null;
        return (
          <div key={key} className="space-y-1.5">
            <h4 className="text-sm font-semibold">
              {t(`summary.groups.${key}`)}
            </h4>
            <ul className="list-disc space-y-1 ps-5 text-sm text-ink-2">
              {items.map((code) => (
                <li key={code}>{t(`summary.items.${code}`)}</li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

import { useTranslations } from "next-intl";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { SafetyBadge } from "@/components/diagnosis/safety-badge";
import { SafeToDriveBadge } from "@/components/diagnosis/safe-to-drive-badge";
import type { DiagnosisResult } from "@/lib/diagnosis/types";

const LIKELIHOOD_TONE = {
  low: "muted",
  medium: "neutral",
  high: "warning",
} as const;

export function DiagnosisResultView({
  result,
  isMock,
}: {
  result: DiagnosisResult;
  isMock: boolean;
}) {
  const t = useTranslations("diagnose");
  const urgent =
    result.safety_level === "urgent" ||
    result.safety_level === "stop_immediately";

  return (
    <div className="space-y-4">
      {isMock ? (
        <p className="rounded-md border border-border bg-muted px-3 py-2 text-xs text-muted-foreground">
          {t("mockNotice")}
        </p>
      ) : null}

      {/* Prominent safety banner for urgent/stop */}
      {urgent ? (
        <div
          className={
            result.safety_level === "stop_immediately"
              ? "rounded-md border border-red-500/40 bg-red-500/10 p-3 text-sm font-medium text-red-700 dark:text-red-400"
              : "rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm font-medium text-amber-700 dark:text-amber-400"
          }
          role="alert"
        >
          {t(`safetyBanner.${result.safety_level}`)}
        </div>
      ) : null}

      <Card>
        <CardHeader className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <SafetyBadge level={result.safety_level} />
            <SafeToDriveBadge value={result.safe_to_drive} />
            <Badge tone="muted">
              {t("confidence.label")}: {t(`confidence.${result.confidence_level}`)}
            </Badge>
          </div>
          <p className="text-sm">{result.symptom_summary}</p>
        </CardHeader>
        <CardContent className="space-y-5">
          {/* Likely causes */}
          {result.likely_causes.length > 0 ? (
            <section className="space-y-2">
              <h3 className="text-sm font-semibold">{t("sections.causes")}</h3>
              <ul className="space-y-2">
                {result.likely_causes.map((c, idx) => (
                  <li key={idx} className="rounded-md border border-border p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium">{c.title}</span>
                      <Badge tone={LIKELIHOOD_TONE[c.likelihood]}>
                        {t(`likelihood.${c.likelihood}`)}
                      </Badge>
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {c.explanation}
                    </p>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {/* Step-by-step checks */}
          {result.step_by_step_checks.length > 0 ? (
            <section className="space-y-2">
              <h3 className="text-sm font-semibold">{t("sections.checks")}</h3>
              <ol className="list-decimal space-y-1 ps-5 text-sm text-muted-foreground">
                {result.step_by_step_checks.map((step, idx) => (
                  <li key={idx}>{step}</li>
                ))}
              </ol>
            </section>
          ) : null}

          {/* When to contact a mechanic */}
          <section className="space-y-1">
            <h3 className="text-sm font-semibold">
              {t("sections.whenToContact")}
            </h3>
            <p className="text-sm text-muted-foreground">
              {result.when_to_stop_and_contact_mechanic}
            </p>
          </section>

          {/* Recommendation */}
          <section className="space-y-1">
            <h3 className="text-sm font-semibold">
              {t("sections.recommendation")}
            </h3>
            <p className="text-sm">
              {t(`recommendation.${result.recommendation}`)}
            </p>
          </section>

          {/* Disclaimer */}
          <p className="rounded-md border border-border p-3 text-xs text-muted-foreground">
            {result.disclaimer}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

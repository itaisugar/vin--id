import Link from "next/link";
import { getTranslations } from "next-intl/server";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { InstallInstructions } from "@/components/pwa/install-instructions";

export interface OnboardingCounts {
  vehicles: number;
  maintenance: number;
  documents: number;
  passports: number;
}

const ctaClass =
  "inline-flex h-9 w-full items-center justify-center rounded-md border border-border px-3 text-sm font-medium transition-colors hover:bg-muted sm:w-auto";

/**
 * Lightweight first-run checklist (not a wizard). Completion for the first four
 * steps is derived from existing data; the last two are manual nudges. Shown on
 * the dashboard until the four data-backed steps are done.
 */
export async function OnboardingChecklist({
  counts,
  primaryVehicleId,
}: {
  counts: OnboardingCounts;
  primaryVehicleId: string | null;
}) {
  const t = await getTranslations("dashboard.checklist");
  const v = primaryVehicleId;

  const steps = [
    {
      key: "vehicle",
      done: counts.vehicles > 0,
      href: "/vehicles/new",
    },
    {
      key: "maintenance",
      done: counts.maintenance > 0,
      href: v ? `/vehicles/${v}/maintenance/new` : "/vehicles/new",
    },
    {
      key: "document",
      done: counts.documents > 0,
      href: v ? `/vehicles/${v}/documents/new` : "/vehicles/new",
    },
    {
      key: "passport",
      done: counts.passports > 0,
      href: v ? `/vehicles/${v}/passports/new` : "/vehicles/new",
    },
    {
      // Manual step — not auto-derived (preview opens aren't user-readable).
      key: "preview",
      done: false,
      href: v && counts.passports > 0 ? `/vehicles/${v}/passports` : null,
    },
  ] as const;

  return (
    <Card>
      <CardHeader className="space-y-1">
        <CardTitle className="text-base">{t("title")}</CardTitle>
        <p className="text-sm text-muted-foreground">{t("explainer")}</p>
      </CardHeader>
      <CardContent>
        <ol className="space-y-3">
          {steps.map((step, i) => (
            <li key={step.key} className="flex items-start gap-3">
              <StepMarker index={i + 1} done={step.done} />
              <div className="min-w-0 flex-1">
                <p
                  className={
                    step.done
                      ? "text-sm font-medium text-muted-foreground line-through"
                      : "text-sm font-medium"
                  }
                >
                  {t(`steps.${step.key}.label`)}
                </p>
                {!step.done && step.href ? (
                  <Link href={step.href} className={`mt-2 ${ctaClass}`}>
                    {t(`steps.${step.key}.cta`)}
                  </Link>
                ) : null}
              </div>
            </li>
          ))}

          {/* Step 6 — Add to Home Screen (manual). */}
          <li className="flex items-start gap-3">
            <StepMarker index={6} done={false} />
            <div className="min-w-0 flex-1 space-y-2">
              <p className="text-sm font-medium">{t("steps.install.label")}</p>
              <InstallInstructions />
            </div>
          </li>
        </ol>
      </CardContent>
    </Card>
  );
}

function StepMarker({ index, done }: { index: number; done: boolean }) {
  if (done) {
    return (
      <span
        aria-hidden
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary"
      >
        ✓
      </span>
    );
  }
  return (
    <span
      aria-hidden
      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-border text-xs font-semibold text-muted-foreground"
    >
      {index}
    </span>
  );
}

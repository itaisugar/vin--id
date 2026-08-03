"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { completeOnboarding } from "@/app/onboarding/actions";
import { Button } from "@/components/ui/button";
import { CarIcon, ScanIcon, PlusIcon } from "@/components/icons";
import { cn } from "@/lib/utils";

/**
 * VIN-ID onboarding — Private-first, two steps, instrument-cluster styled.
 *
 *   1. Welcome — value proposition + one CTA.
 *   2. Add first vehicle — the three existing methods, deep-linked into the
 *      real Add Vehicle flow, plus "I'll add a vehicle later".
 *
 * There is NO mode selection: every new user already has their Personal
 * workspace, so onboarding just guides them to first value. Creating a Business
 * organization and joining via invitation stay where they belong (Team & Access
 * and the invitation link) — deliberately NOT surfaced here. Completion is a
 * cookie (see actions.ts); it is never used for authorization or account type.
 */

type Step = "welcome" | "vehicle";
const STEP_INDEX: Record<Step, number> = { welcome: 1, vehicle: 2 };
const TOTAL = 2;

export function OnboardingFlow() {
  const t = useTranslations("onboarding");
  const [step, setStep] = React.useState<Step>("welcome");
  const [isPending, startTransition] = React.useTransition();

  const go = (target: string) => startTransition(() => { void completeOnboarding(target); });

  return (
    <main className="relative flex min-h-dvh flex-col overflow-hidden bg-bg text-ink">
      {/* Ambient instrument glow */}
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-64 bg-[radial-gradient(60%_100%_at_50%_0%,rgba(65,105,225,0.18),transparent)]" />

      {/* Bezel header: brand + gauge + skip */}
      <header className="relative z-10 flex items-center justify-between gap-3 px-5 py-4">
        <span dir="ltr" className="text-lg font-extrabold tracking-tight">VIN·ID</span>
        <div className="flex items-center gap-3">
          <GaugeStepper current={STEP_INDEX[step]} total={TOTAL} label={t("progress", { current: STEP_INDEX[step], total: TOTAL })} />
          <button
            type="button"
            onClick={() => go("/dashboard")}
            disabled={isPending}
            className="text-sm font-medium text-ink-2 transition hover:text-ink disabled:opacity-50"
          >
            {t("skip")}
          </button>
        </div>
      </header>

      <div className="relative z-10 mx-auto flex w-full max-w-md flex-1 flex-col px-5 pb-10">
        {step === "welcome" ? (
          <WelcomeStep onStart={() => setStep("vehicle")} isPending={isPending} />
        ) : (
          <VehicleStep onBack={() => setStep("welcome")} isPending={isPending} go={go} />
        )}
      </div>
    </main>
  );
}

/* ---- Steps --------------------------------------------------------------- */

function WelcomeStep({ onStart, isPending }: { onStart: () => void; isPending: boolean }) {
  const t = useTranslations("onboarding.welcome");
  return (
    <div className="flex flex-1 flex-col items-center justify-center text-center">
      <RevGauge />
      <h1 className="mt-8 text-3xl font-extrabold tracking-tight text-balance">{t("title")}</h1>
      <p className="mt-3 text-balance text-ink-2">{t("subtitle")}</p>
      <div className="mt-9 w-full">
        <Button className="w-full glow-accent" onClick={onStart} disabled={isPending}>{t("cta")}</Button>
      </div>
    </div>
  );
}

function VehicleStep({ onBack, go, isPending }: { onBack: () => void; go: (t: string) => void; isPending: boolean }) {
  const t = useTranslations("onboarding.vehicle");
  const tRoot = useTranslations("onboarding");
  return (
    <div className="flex flex-1 flex-col justify-center py-6">
      <button type="button" onClick={onBack} className="mb-5 inline-flex items-center gap-1 self-start text-sm font-medium text-accent transition hover:underline">
        <ChevronIcon className="h-4 w-4 rotate-180 rtl:rotate-0" /> {tRoot("back")}
      </button>
      <h1 className="text-2xl font-extrabold tracking-tight text-balance">{t("title")}</h1>
      <div className="mt-6 space-y-3">
        <ChoiceCard icon={<SearchIcon className="h-6 w-6" />} title={t("registration")} desc={t("registrationDesc")} onClick={() => go("/vehicles/new?method=lookup")} disabled={isPending} />
        <ChoiceCard icon={<ScanIcon className="h-6 w-6" />} title={t("scan")} desc={t("scanDesc")} onClick={() => go("/vehicles/new?method=scan")} disabled={isPending} />
        <ChoiceCard icon={<PlusIcon className="h-6 w-6" />} title={t("manual")} desc={t("manualDesc")} onClick={() => go("/vehicles/new?method=manual")} disabled={isPending} />
      </div>
      <button type="button" onClick={() => go("/dashboard")} disabled={isPending} className="mt-6 w-full text-center text-sm font-medium text-ink-2 transition hover:text-ink disabled:opacity-50">
        {t("later")}
      </button>
    </div>
  );
}

/* ---- Shared pieces ------------------------------------------------------- */

function ChoiceCard({ icon, title, desc, onClick, disabled }: {
  icon: React.ReactNode; title: string; desc: string; onClick: () => void; disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "group flex w-full items-center gap-4 rounded-2xl border border-line bg-surface-2 p-4 text-start transition",
        "hover:border-accent/40 hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg",
        "disabled:cursor-not-allowed disabled:opacity-50",
      )}
    >
      <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-line bg-bg text-accent">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block font-semibold text-ink">{title}</span>
        <span className="block text-sm text-ink-2">{desc}</span>
      </span>
      <ChevronIcon className="h-5 w-5 shrink-0 text-ink-3 transition group-hover:text-accent rtl:-scale-x-100" />
    </button>
  );
}

/** Minimal two-notch progress gauge + a digital step readout (no fake segments). */
function GaugeStepper({ current, total, label }: { current: number; total: number; label: string }) {
  return (
    <div className="flex items-center gap-2" role="progressbar" aria-valuemin={1} aria-valuemax={total} aria-valuenow={current} aria-label={label}>
      <div className="flex items-end gap-1" aria-hidden>
        {Array.from({ length: total }).map((_, i) => {
          const on = i < current;
          const last = i === current - 1;
          return (
            <span
              key={i}
              className={cn(
                "w-1.5 rounded-full transition-all",
                i === 0 ? "h-3" : "h-4",
                on ? (last ? "bg-accent glow-accent" : "bg-accent") : "bg-surface-3",
              )}
            />
          );
        })}
      </div>
      <span dir="ltr" className="font-mono text-xs tabular-nums text-ink-2">{String(current).padStart(2, "0")}/{String(total).padStart(2, "0")}</span>
    </div>
  );
}

/** Welcome rev-counter ring — draws once (reduced-motion safe via .animate-ring). */
function RevGauge() {
  const R = 52, C = 2 * Math.PI * R, ARC = 0.75; // 270° sweep
  return (
    <div className="relative h-40 w-40">
      <svg viewBox="0 0 120 120" className="h-full w-full -rotate-[135deg]">
        <circle cx="60" cy="60" r={R} fill="none" stroke="var(--surface-3)" strokeWidth="8" strokeLinecap="round" strokeDasharray={`${C * ARC} ${C}`} />
        <circle
          cx="60" cy="60" r={R} fill="none" stroke="var(--accent)" strokeWidth="8" strokeLinecap="round"
          className="animate-ring"
          style={{
            "--ring-circ": `${C}`,
            "--ring-target": `${C * (1 - ARC)}`,
            strokeDasharray: `${C} ${C}`,
            strokeDashoffset: `${C}`,
          } as React.CSSProperties}
        />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center">
        <CarIcon className="h-12 w-12 text-accent text-glow-accent" />
      </span>
    </div>
  );
}

/* ---- Inline icons -------------------------------------------------------- */

function ChevronIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d="m9 6 6 6-6 6" />
    </svg>
  );
}
function SearchIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" />
    </svg>
  );
}

"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { completeOnboarding } from "@/app/onboarding/actions";
import { CreateOrganizationForm } from "@/components/organization/create-organization-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CarIcon, ScanIcon, PlusIcon, TeamIcon } from "@/components/icons";
import { cn } from "@/lib/utils";

/**
 * VIN-ID onboarding — a short, focused, instrument-cluster styled flow.
 *
 * Welcome → Choose mode → (Personal add-vehicle | Join org | Create org).
 * Nothing here changes backend rules: it reuses the existing vehicle-add flow
 * (/vehicles/new), the invitation landing (/invite/[token]) and the
 * create-organization action. Completion is a cookie (see actions.ts) so a
 * returning user is never shown this again.
 */

type Step = "welcome" | "mode" | "personal" | "join" | "create";

// Position on the 3-notch "gauge": welcome=1, mode=2, any path=3.
const STEP_INDEX: Record<Step, number> = { welcome: 1, mode: 2, personal: 3, join: 3, create: 3 };
const TOTAL = 3;

export function OnboardingFlow({ firstName }: { firstName: string | null }) {
  const t = useTranslations("onboarding");
  const [step, setStep] = React.useState<Step>("welcome");
  const [inviteInput, setInviteInput] = React.useState("");
  const [isPending, startTransition] = React.useTransition();

  const go = (target: string) => startTransition(() => { void completeOnboarding(target); });

  // Set the completion cookie when entering the create step, so the create
  // action's own redirect to Team & Access still counts as "onboarded".
  React.useEffect(() => {
    if (step === "create") startTransition(() => { void completeOnboarding(); });
  }, [step]);

  function proceedJoin() {
    const token = parseInviteToken(inviteInput);
    if (!token) return;
    go(`/invite/${encodeURIComponent(token)}`);
  }

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
        {step === "welcome" && <WelcomeStep firstName={firstName} onStart={() => setStep("mode")} isPending={isPending} />}
        {step === "mode" && <ModeStep onBack={() => setStep("welcome")} onPick={(m) => setStep(m)} />}
        {step === "personal" && <PersonalStep onBack={() => setStep("mode")} isPending={isPending} go={go} />}
        {step === "join" && (
          <JoinStep
            onBack={() => setStep("mode")}
            value={inviteInput}
            onChange={setInviteInput}
            onContinue={proceedJoin}
            onNoLink={() => go("/dashboard")}
            canContinue={parseInviteToken(inviteInput) !== null}
            isPending={isPending}
          />
        )}
        {step === "create" && <CreateStep onBack={() => setStep("mode")} />}
      </div>
    </main>
  );
}

/* ---- Steps --------------------------------------------------------------- */

function WelcomeStep({ firstName, onStart, isPending }: {
  firstName: string | null; onStart: () => void; isPending: boolean;
}) {
  const t = useTranslations("onboarding.welcome");
  return (
    <div className="flex flex-1 flex-col items-center justify-center text-center">
      <RevGauge />
      <h1 className="mt-8 text-3xl font-extrabold tracking-tight">
        {firstName ? t("titleNamed", { name: firstName }) : t("title")}
      </h1>
      <p className="mt-3 text-balance text-ink-2">{t("subtitle")}</p>
      <div className="mt-9 w-full">
        <Button className="w-full glow-accent" onClick={onStart} disabled={isPending}>{t("cta")}</Button>
      </div>
    </div>
  );
}

function ModeStep({ onBack, onPick }: { onBack: () => void; onPick: (m: "personal" | "join" | "create") => void }) {
  const t = useTranslations("onboarding.mode");
  return (
    <StepShell onBack={onBack} title={t("title")} subtitle={t("subtitle")}>
      <div className="space-y-3">
        <ChoiceCard icon={<CarIcon className="h-6 w-6" />} title={t("personal.title")} desc={t("personal.desc")} onClick={() => onPick("personal")} />
        <ChoiceCard icon={<TeamIcon className="h-6 w-6" />} title={t("join.title")} desc={t("join.desc")} onClick={() => onPick("join")} />
        <ChoiceCard icon={<KeyIcon className="h-6 w-6" />} title={t("create.title")} desc={t("create.desc")} onClick={() => onPick("create")} />
      </div>
    </StepShell>
  );
}

function PersonalStep({ onBack, go, isPending }: { onBack: () => void; go: (t: string) => void; isPending: boolean }) {
  const t = useTranslations("onboarding.personal");
  return (
    <StepShell onBack={onBack} title={t("title")} subtitle={t("subtitle")}>
      <div className="space-y-3">
        <ChoiceCard icon={<SearchIcon className="h-6 w-6" />} title={t("registration")} desc={t("registrationDesc")} onClick={() => go("/vehicles/new?method=lookup")} disabled={isPending} />
        <ChoiceCard icon={<ScanIcon className="h-6 w-6" />} title={t("scan")} desc={t("scanDesc")} onClick={() => go("/vehicles/new?method=scan")} disabled={isPending} />
        <ChoiceCard icon={<PlusIcon className="h-6 w-6" />} title={t("manual")} desc={t("manualDesc")} onClick={() => go("/vehicles/new?method=manual")} disabled={isPending} />
      </div>
      <button type="button" onClick={() => go("/dashboard")} disabled={isPending} className="mt-5 w-full text-center text-sm font-medium text-ink-2 transition hover:text-ink disabled:opacity-50">
        {t("later")}
      </button>
    </StepShell>
  );
}

function JoinStep({ onBack, value, onChange, onContinue, onNoLink, canContinue, isPending }: {
  onBack: () => void; value: string; onChange: (v: string) => void; onContinue: () => void;
  onNoLink: () => void; canContinue: boolean; isPending: boolean;
}) {
  const t = useTranslations("onboarding.join");
  return (
    <StepShell onBack={onBack} title={t("title")} subtitle={t("subtitle")}>
      <form onSubmit={(e) => { e.preventDefault(); if (canContinue) onContinue(); }} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="invite">{t("inputLabel")}</Label>
          <Input id="invite" dir="ltr" autoComplete="off" placeholder={t("placeholder")} value={value} onChange={(e) => onChange(e.target.value)} disabled={isPending} />
          <p className="text-xs text-ink-2">{t("help")}</p>
        </div>
        <Button type="submit" className="w-full" disabled={!canContinue || isPending}>{t("continue")}</Button>
      </form>
      <button type="button" onClick={onNoLink} disabled={isPending} className="mt-5 w-full text-center text-sm font-medium text-ink-2 transition hover:text-ink disabled:opacity-50">
        {t("noLink")}
      </button>
    </StepShell>
  );
}

function CreateStep({ onBack }: { onBack: () => void }) {
  const t = useTranslations("onboarding.create");
  return (
    <StepShell onBack={onBack} title={t("title")} subtitle={t("subtitle")}>
      <div className="rounded-2xl border border-line bg-surface p-5 cockpit-lift">
        <CreateOrganizationForm />
      </div>
      <p className="mt-4 text-xs text-ink-2">{t("personalNote")}</p>
    </StepShell>
  );
}

/* ---- Shared pieces ------------------------------------------------------- */

function StepShell({ onBack, title, subtitle, children }: {
  onBack: () => void; title: string; subtitle: string; children: React.ReactNode;
}) {
  const tRoot = useTranslations("onboarding");
  return (
    <div className="flex flex-1 flex-col justify-center py-6">
      <button type="button" onClick={onBack} className="mb-5 inline-flex items-center gap-1 self-start text-sm font-medium text-accent transition hover:underline">
        <ChevronIcon className="h-4 w-4 rotate-180 rtl:rotate-0" /> {tRoot("back")}
      </button>
      <h1 className="text-2xl font-extrabold tracking-tight">{title}</h1>
      <p className="mt-2 text-sm text-ink-2">{subtitle}</p>
      <div className="mt-6">{children}</div>
    </div>
  );
}

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

/** Tach-style progress gauge: redline segments + a digital step readout. */
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
                i === 0 ? "h-2.5" : i === 1 ? "h-3.5" : "h-4",
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

/* ---- Inline icons (kept minimal; reuse shared ones where they exist) ----- */

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
function KeyIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <circle cx="7.5" cy="15.5" r="4.5" /><path d="m10.7 12.3 8.3-8.3M16 6l3 3M13.5 8.5 16 11" />
    </svg>
  );
}

/** Extract an invitation token from a pasted full URL, path, or raw token. */
export function parseInviteToken(raw: string): string | null {
  const s = (raw || "").trim();
  if (!s) return null;
  const m = s.match(/\/invite\/([^/?#]+)/);
  const token = (m ? m[1] : s).trim();
  return token.length > 0 ? token : null;
}

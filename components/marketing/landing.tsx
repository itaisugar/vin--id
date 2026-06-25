import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { LanguageSwitcher } from "@/components/language-switcher";
import { LegalFooterLinks } from "@/components/legal-footer-links";
import {
  CarIcon,
  WrenchIcon,
  AlertIcon,
  DocumentIcon,
  BellIcon,
  ShieldIcon,
} from "@/components/icons";

const FEATURES = [
  { key: "history", Icon: CarIcon },
  { key: "maintenance", Icon: WrenchIcon },
  { key: "issues", Icon: AlertIcon },
  { key: "documents", Icon: DocumentIcon },
  { key: "reminders", Icon: BellIcon },
  { key: "passport", Icon: ShieldIcon },
] as const;

/** Public marketing landing page (signed-out visitors). */
export async function Landing({ mockAi }: { mockAi: boolean }) {
  const t = await getTranslations("landing");
  const tc = await getTranslations("common");

  const problemPoints = t.raw("problem.points") as string[];
  const passportPoints = t.raw("passport.points") as string[];
  const passportDisclaimers = t.raw("passport.disclaimers") as string[];
  const betaPoints = t.raw("beta.points") as string[];
  const privacyPoints = t.raw("privacy.points") as string[];

  const primaryBtn =
    "inline-flex h-11 items-center justify-center rounded-md bg-primary px-5 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90";
  const outlineBtn =
    "inline-flex h-11 items-center justify-center rounded-md border border-border px-5 text-sm font-semibold transition-colors hover:bg-muted";

  return (
    <div className="flex min-h-dvh flex-col bg-background text-foreground">
      {/* Top nav */}
      <header className="border-b border-border">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="text-lg font-bold">{tc("appName")}</span>
            <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              {tc("beta")}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <LanguageSwitcher />
            <Link
              href="/login"
              className="hidden h-9 items-center rounded-md px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted sm:inline-flex"
            >
              {t("nav.signIn")}
            </Link>
            <Link
              href="/signup"
              className="inline-flex h-9 items-center justify-center rounded-md bg-primary px-3 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90"
            >
              {t("nav.startBeta")}
            </Link>
          </div>
        </div>
      </header>

      <main className="flex-1">
        {/* A. Hero */}
        <section className="mx-auto w-full max-w-5xl px-4 py-14 sm:py-20">
          <div className="max-w-2xl space-y-5">
            <span className="inline-block rounded-full border border-border px-3 py-1 text-xs font-medium text-muted-foreground">
              {t("hero.badge")}
            </span>
            <h1 className="text-3xl font-bold leading-tight sm:text-5xl">
              {t("hero.headline")}
            </h1>
            <p className="text-base text-muted-foreground sm:text-lg">
              {t("hero.subheadline")}
            </p>
            <div className="flex flex-col gap-3 pt-2 sm:flex-row">
              <Link href="/signup" className={primaryBtn}>
                {t("hero.primaryCta")}
              </Link>
              <Link href="#passport" className={outlineBtn}>
                {t("hero.secondaryCta")}
              </Link>
            </div>
          </div>
        </section>

        {/* B. Problem */}
        <section className="border-t border-border bg-muted/30">
          <div className="mx-auto w-full max-w-5xl px-4 py-12">
            <h2 className="text-xl font-semibold sm:text-2xl">
              {t("problem.title")}
            </h2>
            <ul className="mt-4 grid gap-3 sm:grid-cols-3">
              {problemPoints.map((point) => (
                <li
                  key={point}
                  className="rounded-lg border border-border bg-background p-4 text-sm text-muted-foreground"
                >
                  {point}
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* C. What Vin.ID does */}
        <section className="mx-auto w-full max-w-5xl px-4 py-12">
          <h2 className="text-xl font-semibold sm:text-2xl">
            {t("features.title")}
          </h2>
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map(({ key, Icon }) => (
              <div
                key={key}
                className="rounded-lg border border-border bg-background p-5"
              >
                <Icon className="h-6 w-6 text-primary" />
                <h3 className="mt-3 font-semibold">
                  {t(`features.items.${key}.title`)}
                </h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  {t(`features.items.${key}.body`)}
                </p>
              </div>
            ))}
          </div>
        </section>

        {/* D. Vehicle Passport */}
        <section
          id="passport"
          className="scroll-mt-16 border-y border-border bg-muted/30"
        >
          <div className="mx-auto w-full max-w-5xl px-4 py-12">
            <h2 className="text-xl font-semibold sm:text-2xl">
              {t("passport.title")}
            </h2>
            <p className="mt-2 max-w-2xl text-muted-foreground">
              {t("passport.lead")}
            </p>
            <div className="mt-6 grid gap-6 lg:grid-cols-2">
              <ul className="space-y-2">
                {passportPoints.map((point) => (
                  <li key={point} className="flex items-start gap-2 text-sm">
                    <span aria-hidden className="mt-1 text-primary">
                      ✓
                    </span>
                    <span>{point}</span>
                  </li>
                ))}
              </ul>
              <div className="rounded-lg border border-border bg-background p-5">
                <h3 className="text-sm font-semibold">
                  {t("passport.disclaimerTitle")}
                </h3>
                <ul className="mt-2 space-y-1.5 text-xs text-muted-foreground">
                  {passportDisclaimers.map((d) => (
                    <li key={d}>• {d}</li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </section>

        {/* E. Beta notice */}
        <section className="mx-auto w-full max-w-5xl px-4 py-12">
          <div className="rounded-lg border border-warn/30 bg-warn/10 p-5">
            <h2 className="text-base font-semibold text-warn">
              {t("beta.title")}
            </h2>
            <ul className="mt-3 space-y-1.5 text-sm text-warn/90">
              {betaPoints.map((point) => (
                <li key={point}>• {point}</li>
              ))}
              {mockAi ? <li>• {t("beta.mockNote")}</li> : null}
            </ul>
          </div>
        </section>

        {/* F. Privacy / trust */}
        <section className="border-t border-border bg-muted/30">
          <div className="mx-auto w-full max-w-5xl px-4 py-12">
            <h2 className="text-xl font-semibold sm:text-2xl">
              {t("privacy.title")}
            </h2>
            <ul className="mt-4 grid gap-3 sm:grid-cols-2">
              {privacyPoints.map((point) => (
                <li
                  key={point}
                  className="rounded-lg border border-border bg-background p-4 text-sm text-muted-foreground"
                >
                  {point}
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* G. CTA */}
        <section className="mx-auto w-full max-w-5xl px-4 py-16 text-center">
          <h2 className="text-2xl font-bold sm:text-3xl">{t("cta.title")}</h2>
          <p className="mt-2 text-muted-foreground">{t("cta.subtitle")}</p>
          <div className="mt-6 flex flex-col justify-center gap-3 sm:flex-row">
            <Link href="/signup" className={primaryBtn}>
              {t("cta.startBeta")}
            </Link>
            <Link href="/login" className={outlineBtn}>
              {t("cta.signIn")}
            </Link>
          </div>
          <p className="mt-6 text-xs text-muted-foreground">{t("testerNote")}</p>
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t border-border">
        <div className="mx-auto flex w-full max-w-5xl flex-col items-center gap-2 px-4 py-6 text-center text-xs text-muted-foreground">
          <span>
            {tc("appName")} · {t("footerTagline")}
          </span>
          <LegalFooterLinks />
        </div>
      </footer>
    </div>
  );
}

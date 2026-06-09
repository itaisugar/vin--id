import { getTranslations } from "next-intl/server";
import { LanguageSwitcher } from "@/components/language-switcher";
import { LegalFooterLinks } from "@/components/legal-footer-links";

/** Public chrome for /p/[token] — no authenticated app sidebar. */
export async function PublicShell({ children }: { children: React.ReactNode }) {
  const t = await getTranslations("common");

  return (
    <div className="flex min-h-dvh flex-col bg-muted/30">
      <header className="border-b border-border bg-background">
        <div className="mx-auto flex w-full max-w-3xl items-center justify-between px-4 py-3">
          <span className="text-lg font-bold">{t("appName")}</span>
          <LanguageSwitcher />
        </div>
      </header>
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-6">
        {children}
      </main>
      <footer className="border-t border-border bg-background">
        <div className="mx-auto flex w-full max-w-3xl flex-col items-center gap-1 px-4 py-3 text-center text-xs text-muted-foreground">
          <span>
            {t("appName")} · {t("tagline")}
          </span>
          <LegalFooterLinks />
        </div>
      </footer>
    </div>
  );
}

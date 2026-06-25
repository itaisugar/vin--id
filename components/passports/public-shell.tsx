import { getTranslations } from "next-intl/server";
import { LanguageSwitcher } from "@/components/language-switcher";
import { LegalFooterLinks } from "@/components/legal-footer-links";

/** Public chrome for /p/[token] — no authenticated app sidebar. */
export async function PublicShell({ children }: { children: React.ReactNode }) {
  const t = await getTranslations("common");

  return (
    <div className="flex min-h-dvh flex-col bg-bg">
      <header className="border-b border-line bg-surface/80 backdrop-blur-md">
        <div className="mx-auto flex w-full max-w-3xl items-center justify-between px-4 py-3">
          <span dir="ltr" className="text-lg font-extrabold tracking-tight">
            {t("appName")}
          </span>
          <LanguageSwitcher />
        </div>
      </header>
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-6">
        {children}
      </main>
      <footer className="border-t border-line">
        <div className="mx-auto flex w-full max-w-3xl flex-col items-center gap-1 px-4 py-3 text-center text-xs text-ink-3">
          <span>
            <span dir="ltr" className="font-extrabold tracking-tight">
              {t("appName")}
            </span>{" "}
            · {t("tagline")}
          </span>
          <LegalFooterLinks />
        </div>
      </footer>
    </div>
  );
}

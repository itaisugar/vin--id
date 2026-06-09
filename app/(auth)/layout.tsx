import { getTranslations } from "next-intl/server";
import { LanguageSwitcher } from "@/components/language-switcher";
import { LegalFooterLinks } from "@/components/legal-footer-links";

export default async function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const t = await getTranslations("common");

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex items-center justify-between p-4">
        <div className="flex items-center gap-2">
          <span className="text-lg font-bold">{t("appName")}</span>
          <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            {t("beta")}
          </span>
        </div>
        <LanguageSwitcher />
      </header>
      <main className="flex flex-1 items-center justify-center px-4">
        <div className="w-full max-w-sm">{children}</div>
      </main>
      <footer className="p-4">
        <LegalFooterLinks />
      </footer>
    </div>
  );
}

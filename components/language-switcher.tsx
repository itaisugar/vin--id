"use client";

import { useLocale, useTranslations } from "next-intl";
import { useTransition } from "react";
import { setLocale } from "@/i18n/actions";
import { localeNames, locales, type Locale } from "@/i18n/config";
import { cn } from "@/lib/utils";

/** Cookie-backed locale switcher (next-intl without i18n routing). */
export function LanguageSwitcher({ className }: { className?: string }) {
  const t = useTranslations("common");
  const active = useLocale();
  const [isPending, startTransition] = useTransition();

  return (
    <div
      className={cn("inline-flex items-center gap-1", className)}
      role="group"
      aria-label={t("language")}
    >
      {locales.map((locale) => (
        <button
          key={locale}
          type="button"
          disabled={isPending || locale === active}
          aria-pressed={locale === active}
          onClick={() =>
            startTransition(() => {
              void setLocale(locale as Locale);
            })
          }
          className={cn(
            "rounded-md px-2 py-1 text-xs font-medium transition-colors disabled:cursor-default",
            locale === active
              ? "bg-accent text-on-accent"
              : "text-ink-2 hover:bg-surface-2",
          )}
        >
          {localeNames[locale]}
        </button>
      ))}
    </div>
  );
}

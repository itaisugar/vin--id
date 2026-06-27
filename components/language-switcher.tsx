"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { setLocale } from "@/i18n/actions";
import { localeNames, locales, type Locale } from "@/i18n/config";
import { GlobeIcon } from "@/components/icons";
import { cn } from "@/lib/utils";

/**
 * Cookie-backed locale switcher (next-intl without i18n routing). The trigger is
 * a single globe icon button that opens a small popover to pick a language;
 * closes on Esc / outside-click and is keyboard accessible.
 */
export function LanguageSwitcher({ className }: { className?: string }) {
  const t = useTranslations("common");
  const active = useLocale();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close on Esc + outside pointer. Listeners only set state on events (never
  // synchronously in the effect body), so this satisfies the set-state-in-effect
  // lint rule.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const choose = (locale: Locale) => {
    setOpen(false);
    if (locale === active) return;
    startTransition(() => {
      void setLocale(locale);
    });
  };

  return (
    <div ref={containerRef} className={cn("relative", className)}>
      <button
        type="button"
        aria-label={t("language")}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={isPending}
        onClick={() => setOpen((o) => !o)}
        className="flex h-9 w-9 items-center justify-center rounded-xl border border-line bg-surface-2 text-ink-2 transition-colors hover:bg-surface hover:text-ink disabled:opacity-50"
      >
        <GlobeIcon className="h-5 w-5" />
      </button>

      {open ? (
        <div
          role="menu"
          aria-label={t("language")}
          className="absolute z-50 mt-1 min-w-[8rem] max-w-[calc(100vw-1rem)] overflow-hidden rounded-xl border border-line bg-surface py-1 cockpit-lift ltr:right-0 rtl:left-0"
        >
          {locales.map((locale) => (
            <button
              key={locale}
              type="button"
              role="menuitemradio"
              aria-checked={locale === active}
              onClick={() => choose(locale as Locale)}
              className={cn(
                "block w-full px-3 py-2 text-start text-sm transition-colors hover:bg-surface-2",
                locale === active ? "font-semibold text-accent" : "text-ink",
              )}
            >
              {localeNames[locale]}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** Supported locales and locale metadata. Shared by client and server. */
export const locales = ["en", "he"] as const;

export type Locale = (typeof locales)[number];

export const defaultLocale: Locale = "en";

/** Text direction per locale — drives the `dir` attribute and RTL styling. */
export const localeDirection: Record<Locale, "ltr" | "rtl"> = {
  en: "ltr",
  he: "rtl",
};

/** Native display name for each locale (used by the language switcher). */
export const localeNames: Record<Locale, string> = {
  en: "English",
  he: "עברית",
};

/** Cookie that stores the user's chosen locale (next-intl without routing). */
export const LOCALE_COOKIE = "NEXT_LOCALE";

export function isLocale(value: string): value is Locale {
  return (locales as readonly string[]).includes(value);
}

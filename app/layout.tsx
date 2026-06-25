import type { Metadata, Viewport } from "next";
import { Heebo, Spline_Sans_Mono } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getLocale } from "next-intl/server";
import { localeDirection, type Locale } from "@/i18n/config";
import "./globals.css";

// COCKPIT typography: Heebo for UI/Hebrew, Spline Sans Mono for data numerals.
// Both are variable fonts (self-hosted by next/font), exposed as CSS variables
// consumed by --font-sans / --font-mono in globals.css.
const heebo = Heebo({
  subsets: ["hebrew", "latin"],
  variable: "--font-heebo",
  display: "swap",
});

const splineMono = Spline_Sans_Mono({
  subsets: ["latin"],
  variable: "--font-spline-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Vin.ID",
  description: "Your smart digital vehicle identity",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "Vin.ID",
    statusBarStyle: "black-translucent",
  },
  icons: {
    icon: "/icons/icon-192.png",
    apple: "/icons/apple-touch-icon.png",
  },
};

export const viewport: Viewport = {
  themeColor: "#0C0E11",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const locale = (await getLocale()) as Locale;
  const dir = localeDirection[locale] ?? "ltr";

  return (
    <html
      lang={locale}
      dir={dir}
      className={`${heebo.variable} ${splineMono.variable} h-full antialiased`}
    >
      <body className="min-h-full bg-bg text-ink">
        <NextIntlClientProvider>{children}</NextIntlClientProvider>
      </body>
    </html>
  );
}

"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

/** Public footer links (Privacy / Terms). Not shown in the authenticated app. */
export function LegalFooterLinks({ className }: { className?: string }) {
  const t = useTranslations("common.footer");
  return (
    <nav
      aria-label={t("label")}
      className={cn(
        "flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-xs text-ink-2",
        className,
      )}
    >
      <Link href="/privacy" className="hover:underline">
        {t("privacy")}
      </Link>
      <Link href="/terms" className="hover:underline">
        {t("terms")}
      </Link>
    </nav>
  );
}

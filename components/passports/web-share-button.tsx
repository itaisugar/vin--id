"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";

/**
 * Share button using the Web Share API when available, falling back to copying
 * the link to the clipboard. Uses ONLY the raw share URL passed in (available
 * in the immediate post-creation state) — it never reconstructs a token.
 * Safe on desktop browsers without navigator.share (it copies instead).
 */
const subscribe = () => () => {};

export function WebShareButton({ url, title }: { url: string; title: string }) {
  const t = useTranslations("passports.share");
  const [copied, setCopied] = React.useState(false);

  // SSR-safe capability check: false on server/hydration, real value after.
  const canShare = React.useSyncExternalStore(
    subscribe,
    () =>
      typeof navigator !== "undefined" && typeof navigator.share === "function",
    () => false,
  );

  const onClick = async () => {
    if (canShare) {
      try {
        await navigator.share({ title, url });
        return;
      } catch {
        // User cancelled or share failed — fall through to copy.
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard unavailable — the link input remains selectable as a fallback.
    }
  };

  return (
    <Button type="button" onClick={onClick} className="w-full sm:w-auto">
      {canShare ? t("share") : copied ? t("copied") : t("copy")}
    </Button>
  );
}

"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { copyToClipboard } from "@/lib/clipboard";

/**
 * Share button using the Web Share API when available, falling back to copying
 * the link to the clipboard. Uses ONLY the raw share URL passed in (available
 * in the immediate post-creation state) — it never reconstructs a token.
 * Safe on desktop browsers without navigator.share (it copies instead) and
 * never throws.
 */
const subscribe = () => () => {};

export function WebShareButton({
  url,
  title,
  text,
}: {
  url: string;
  title: string;
  text?: string;
}) {
  const t = useTranslations("passports.share");
  const [status, setStatus] = React.useState<"idle" | "copied" | "error">(
    "idle",
  );

  // SSR-safe capability check: false on server/hydration, real value after.
  const canShare = React.useSyncExternalStore(
    subscribe,
    () =>
      typeof navigator !== "undefined" && typeof navigator.share === "function",
    () => false,
  );

  const flash = (next: "copied" | "error") => {
    setStatus(next);
    setTimeout(() => setStatus("idle"), 2000);
  };

  const onClick = async () => {
    // Never act on a missing URL.
    if (!url) return;

    if (canShare) {
      try {
        await navigator.share(text ? { title, text, url } : { title, url });
        return;
      } catch {
        // User cancelled or share failed — fall through to copy as a fallback.
      }
    }

    flash((await copyToClipboard(url)) ? "copied" : "error");
  };

  const label = canShare
    ? t("share")
    : status === "copied"
      ? t("copied")
      : t("copy");

  return (
    <div className="w-full sm:w-auto">
      <Button type="button" onClick={onClick} className="w-full sm:w-auto">
        {label}
      </Button>
      {status === "error" ? (
        <p role="alert" className="mt-1 text-xs text-red-600">
          {t("copyFailed")}
        </p>
      ) : null}
    </div>
  );
}

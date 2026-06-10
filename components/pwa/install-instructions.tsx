"use client";

import * as React from "react";
import { useTranslations } from "next-intl";

type Platform = "standalone" | "ios" | "android" | "generic";

function getPlatform(): Platform {
  if (typeof window === "undefined" || typeof navigator === "undefined") {
    return "generic";
  }
  const standalone =
    window.matchMedia?.("(display-mode: standalone)")?.matches ||
    // iOS Safari exposes navigator.standalone when launched from home screen.
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
  if (standalone) return "standalone";

  const ua = navigator.userAgent || "";
  if (/iphone|ipad|ipod/i.test(ua)) return "ios";
  if (/android/i.test(ua)) return "android";
  return "generic";
}

const noopSubscribe = () => () => {};

/**
 * Short, non-blocking "Add to Home Screen" guidance. Lightly detects the
 * platform (no heavy device detection). Renders nothing when the app is already
 * running standalone. SSR-safe via useSyncExternalStore (server snapshot =
 * "generic", so no hydration mismatch).
 */
export function InstallInstructions() {
  const t = useTranslations("install");
  const platform = React.useSyncExternalStore(
    noopSubscribe,
    getPlatform,
    () => "generic" as Platform,
  );

  if (platform === "standalone") return null;

  const body =
    platform === "ios"
      ? t("ios")
      : platform === "android"
        ? t("android")
        : t("generic");

  return (
    <div className="rounded-md border border-border bg-background p-3 text-sm">
      <p className="font-medium">{t("title")}</p>
      <p className="mt-1 text-muted-foreground">{body}</p>
    </div>
  );
}

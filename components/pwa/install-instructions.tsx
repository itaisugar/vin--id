"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { DownloadIcon } from "@/components/icons";

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
 * Settings → "Install app". Renders a clickable row that opens an accessible,
 * step-by-step "Add to Home Screen" guide tailored to the visitor's platform.
 * Lightly detects the platform (no heavy device detection). SSR-safe via
 * useSyncExternalStore (server snapshot = "generic", so no hydration mismatch).
 */
export function InstallInstructions() {
  const t = useTranslations("install");
  const [open, setOpen] = React.useState(false);
  const platform = React.useSyncExternalStore(
    noopSubscribe,
    getPlatform,
    () => "generic" as Platform,
  );

  const steps = t.raw(
    platform === "ios"
      ? "iosSteps"
      : platform === "android"
        ? "androidSteps"
        : "genericSteps",
  ) as string[];

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex w-full items-center gap-3 rounded-md border border-border bg-background p-3 text-start transition-colors hover:bg-muted"
      >
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
          <DownloadIcon className="h-5 w-5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium">{t("settingsTitle")}</span>
          <span className="block text-xs text-muted-foreground">
            {t("cardSubtitle")}
          </span>
        </span>
      </button>

      <InstallDialog
        open={open}
        onClose={() => setOpen(false)}
        title={t("dialogTitle")}
        intro={platform === "standalone" ? t("alreadyInstalled") : t("dialogIntro")}
        steps={platform === "standalone" ? [] : steps}
        closeLabel={t("close")}
      />
    </>
  );
}

function InstallDialog({
  open,
  onClose,
  title,
  intro,
  steps,
  closeLabel,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  intro: string;
  steps: string[];
  closeLabel: string;
}) {
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="install-dialog-title"
    >
      <button
        type="button"
        aria-label={closeLabel}
        className="absolute inset-0 bg-black/50"
        onClick={onClose}
      />
      <div className="relative w-full max-w-sm rounded-lg border border-border bg-background p-5 shadow-lg">
        <h2 id="install-dialog-title" className="text-lg font-semibold">
          {title}
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">{intro}</p>

        {steps.length > 0 ? (
          <ol className="mt-4 space-y-3">
            {steps.map((step, i) => (
              <li key={i} className="flex gap-3 text-sm">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                  {i + 1}
                </span>
                <span className="pt-0.5">{step}</span>
              </li>
            ))}
          </ol>
        ) : null}

        <div className="mt-5 flex justify-end">
          <Button type="button" onClick={onClose}>
            {closeLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import {
  CarIcon,
  CloseIcon,
  DiagnoseIcon,
  PlusIcon,
  ScanIcon,
} from "@/components/icons";

type Action = {
  key: "scan" | "diagnose" | "addVehicle";
  href: string;
  icon: typeof ScanIcon;
};

// Global "create" actions that work from anywhere without a preselected
// vehicle (so we never offer an action that 404s without a vehicle id).
const ACTIONS: Action[] = [
  { key: "scan", href: "/scan", icon: ScanIcon },
  { key: "diagnose", href: "/diagnose", icon: DiagnoseIcon },
  { key: "addVehicle", href: "/vehicles/new", icon: CarIcon },
];

/**
 * The raised amber FAB at the center of the mobile bottom nav. Tapping it opens
 * a bottom sheet of global quick-create actions. Navigation closes the sheet
 * (via pathname change), and Esc / scrim tap dismiss it.
 */
export function QuickActionFab() {
  const t = useTranslations("nav.quickAdd");
  const [open, setOpen] = useState(false);

  // Esc to close + lock background scroll while open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={t("open")}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="-mt-7 flex h-14 w-14 items-center justify-center rounded-full bg-accent text-on-accent glow-accent transition active:scale-90"
      >
        <PlusIcon className="h-7 w-7" />
      </button>

      {/* Scrim + sheet (kept mounted for enter/exit animation). */}
      <div
        className={`fixed inset-0 z-40 md:hidden ${
          open ? "" : "pointer-events-none"
        }`}
        aria-hidden={!open}
      >
        <button
          type="button"
          tabIndex={-1}
          aria-label={t("close")}
          onClick={() => setOpen(false)}
          className={`absolute inset-0 bg-[rgba(4,6,9,0.65)] backdrop-blur-sm transition-opacity duration-300 ${
            open ? "opacity-100" : "opacity-0"
          }`}
        />

        <div
          role="dialog"
          aria-modal="true"
          aria-label={t("title")}
          className={`absolute inset-x-0 bottom-0 rounded-t-3xl border-t border-line bg-surface p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] shadow-[0_-20px_50px_-16px_rgba(0,0,0,0.7)] transition-transform duration-300 ease-out ${
            open ? "translate-y-0" : "translate-y-full"
          }`}
        >
          <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-line-strong" />
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-bold tracking-tight">{t("title")}</h2>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label={t("close")}
              className="flex h-8 w-8 items-center justify-center rounded-xl border border-line bg-surface-2 text-ink-2"
            >
              <CloseIcon className="h-4 w-4" />
            </button>
          </div>

          <ul className="space-y-2">
            {ACTIONS.map(({ key, href, icon: Icon }) => (
              <li key={key}>
                <Link
                  href={href}
                  onClick={() => setOpen(false)}
                  className="flex items-center gap-3 rounded-xl border border-line bg-surface-3 p-3.5 text-sm font-semibold transition active:scale-[.99] hover:bg-surface-2"
                >
                  <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent/12 text-accent">
                    <Icon className="h-5 w-5" />
                  </span>
                  {t(key)}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </>
  );
}

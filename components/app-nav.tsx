"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { navItems } from "@/components/nav-config";
import { cn } from "@/lib/utils";

function useIsActive() {
  const pathname = usePathname();
  return (href: string) => pathname === href || pathname.startsWith(`${href}/`);
}

/** Desktop: vertical sidebar navigation (hidden on mobile). */
export function SidebarNav() {
  const t = useTranslations("nav");
  const isActive = useIsActive();

  return (
    <nav className="flex flex-col gap-1" aria-label="Primary">
      {navItems.map(({ key, href, icon: Icon, enabled }) => {
        const active = enabled && isActive(href);
        const content = (
          <>
            <Icon className="h-5 w-5 shrink-0" />
            <span>{t(key)}</span>
          </>
        );

        if (!enabled) {
          return (
            <span
              key={key}
              aria-disabled="true"
              className="flex cursor-default items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground/50"
            >
              {content}
            </span>
          );
        }

        return (
          <Link
            key={key}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
              active
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-muted",
            )}
          >
            {content}
          </Link>
        );
      })}
    </nav>
  );
}

/** Mobile: fixed bottom navigation bar (hidden on desktop). */
export function BottomNav() {
  const t = useTranslations("nav");
  const isActive = useIsActive();

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-background pb-[env(safe-area-inset-bottom)] md:hidden"
      aria-label="Primary"
    >
      <ul className="grid grid-cols-4">
        {navItems.map(({ key, href, icon: Icon, enabled }) => {
          const active = enabled && isActive(href);
          const inner = (
            <span
              className={cn(
                "flex flex-col items-center gap-1 py-2 text-xs font-medium",
                !enabled && "text-muted-foreground/40",
                enabled && active && "text-primary",
                enabled && !active && "text-muted-foreground",
              )}
            >
              <Icon className="h-5 w-5" />
              {t(key)}
            </span>
          );

          return (
            <li key={key}>
              {enabled ? (
                <Link
                  href={href}
                  aria-current={active ? "page" : undefined}
                  className="block"
                >
                  {inner}
                </Link>
              ) : (
                <span aria-disabled="true" className="block cursor-default">
                  {inner}
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

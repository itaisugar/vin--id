"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { navItems, type NavItem } from "@/components/nav-config";
import { QuickActionFab } from "@/components/quick-action-fab";
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
              className="flex cursor-default items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-ink-2/50"
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
              "flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition",
              active
                ? "bg-surface-2 text-accent"
                : "text-ink-2 hover:bg-surface-2 hover:text-ink",
            )}
          >
            {content}
          </Link>
        );
      })}
    </nav>
  );
}

/** One mobile bottom-nav slot. */
function BottomNavSlot({
  item,
  active,
  label,
}: {
  item: NavItem;
  active: boolean;
  label: string;
}) {
  const { href, icon: Icon, enabled } = item;
  const inner = (
    <span
      className={cn(
        "flex flex-col items-center gap-1 py-2 text-[11px] font-medium",
        !enabled && "text-ink-3/50",
        enabled && active && "text-accent",
        enabled && !active && "text-ink-3",
      )}
    >
      <Icon className="h-[22px] w-[22px]" />
      {label}
    </span>
  );

  if (!enabled) {
    return (
      <span aria-disabled="true" className="block cursor-default">
        {inner}
      </span>
    );
  }
  return (
    <Link href={href} aria-current={active ? "page" : undefined} className="block">
      {inner}
    </Link>
  );
}

/**
 * Mobile: fixed bottom navigation bar (hidden on desktop). Five slots — two nav
 * items, the raised amber quick-action FAB, then the remaining two nav items.
 */
export function BottomNav() {
  const t = useTranslations("nav");
  const isActive = useIsActive();

  const left = navItems.slice(0, 2);
  const right = navItems.slice(2);

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-[rgba(16,19,23,0.92)] pb-[env(safe-area-inset-bottom)] backdrop-blur-md md:hidden"
      aria-label="Primary"
    >
      <ul className="grid grid-cols-5 items-center pt-2">
        {left.map((item) => (
          <li key={item.key}>
            <BottomNavSlot
              item={item}
              active={item.enabled && isActive(item.href)}
              label={t(item.key)}
            />
          </li>
        ))}

        <li className="flex justify-center">
          <QuickActionFab />
        </li>

        {right.map((item) => (
          <li key={item.key}>
            <BottomNavSlot
              item={item}
              active={item.enabled && isActive(item.href)}
              label={t(item.key)}
            />
          </li>
        ))}
      </ul>
    </nav>
  );
}

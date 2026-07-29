import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentRole } from "@/lib/organizations/service";
import { canManageOrganization, isDriverRole } from "@/lib/organizations/types";
import { SidebarNav, BottomNav } from "@/components/app-nav";
import { LanguageSwitcher } from "@/components/language-switcher";
import { LogoutButton } from "@/components/logout-button";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Real authorization check (the proxy only does an optimistic redirect).
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const t = await getTranslations("common");

  // Drivers get a reduced navigation set. Presentation only — every Fleet screen
  // also guards itself, and RLS denies the data regardless of what is rendered.
  const role = await getCurrentRole();
  const isDriver = isDriverRole(role);
  // Team & Access appears for owner/admin, the same set the organization screen,
  // list_organization_members() and the invitation policies all require.
  const canManageTeam = role != null && canManageOrganization(role);

  return (
    <div className="flex min-h-dvh flex-col">
      {/* Top bar */}
      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-line bg-bg/80 px-4 py-3 backdrop-blur-md print:hidden">
        <div className="flex items-center gap-2">
          <span dir="ltr" className="text-lg font-extrabold tracking-tight">
            {t("appName")}
          </span>
          <span className="rounded-full border border-accent/20 bg-accent/12 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-accent">
            {t("beta")}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <LanguageSwitcher />
          <LogoutButton className="hidden sm:inline-flex" />
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-6xl flex-1">
        {/* Desktop sidebar */}
        <aside className="hidden w-60 shrink-0 border-e border-line p-4 md:flex md:flex-col md:justify-between print:hidden">
          <SidebarNav isDriver={isDriver} canManageOrganization={canManageTeam} />
          <LogoutButton className="w-full justify-start" />
        </aside>

        {/* Main content (extra bottom padding leaves room for the mobile nav,
            including the iOS home-indicator safe area).

            `min-w-0` is load-bearing. A flex item defaults to `min-width: auto`,
            which refuses to shrink below its content's minimum width — so one
            wide child (a long vehicle name, the filter chip strip, a wide table)
            pushed <main> past the viewport and gave the WHOLE PAGE a horizontal
            scrollbar, in both directions: content ran off the right in English
            and off the left in Hebrew. Every screen that scrolled sideways at
            320/375/768px traced back to this one declaration; the components
            themselves already wrap and truncate correctly, they were simply
            never given a bounded width to do it in. */}
        <main className="min-w-0 flex-1 p-4 pb-[calc(6.5rem+env(safe-area-inset-bottom))] md:pb-8">
          {children}
        </main>
      </div>

      {/* Mobile bottom navigation */}
      <div className="print:hidden">
        <BottomNav isDriver={isDriver} />
      </div>
    </div>
  );
}

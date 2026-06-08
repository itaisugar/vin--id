"use client";

import { useFormStatus } from "react-dom";
import { useTranslations } from "next-intl";
import { logout } from "@/app/(auth)/actions";
import { LogoutIcon } from "@/components/icons";
import { cn } from "@/lib/utils";

function LogoutInner({ className }: { className?: string }) {
  const t = useTranslations("auth");
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      className={cn(
        "inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted disabled:opacity-50",
        className,
      )}
    >
      <LogoutIcon className="h-5 w-5" />
      <span>{pending ? t("signingOut") : t("signOut")}</span>
    </button>
  );
}

export function LogoutButton({ className }: { className?: string }) {
  return (
    <form action={logout}>
      <LogoutInner className={className} />
    </form>
  );
}

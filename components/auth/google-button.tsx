"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";

/**
 * "Continue with Google" via Supabase Auth OAuth. The browser is redirected to
 * Google and back to /auth/callback (which exchanges the code for a session).
 * Email/password auth is unaffected. No secrets here — only the public anon key.
 */
export function GoogleButton({ next }: { next?: string }) {
  const t = useTranslations("auth");
  const [isPending, setPending] = React.useState(false);
  const [failed, setFailed] = React.useState(false);

  const onClick = async () => {
    setFailed(false);
    setPending(true);
    try {
      const supabase = createClient();
      const target =
        next && next.startsWith("/") && !next.startsWith("//")
          ? next
          : "/dashboard";
      const redirectTo = `${window.location.origin}/auth/callback?next=${encodeURIComponent(target)}`;
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo },
      });
      if (error) {
        setFailed(true);
        setPending(false);
      }
      // On success the browser navigates away to Google — nothing more to do.
    } catch {
      setFailed(true);
      setPending(false);
    }
  };

  return (
    <div className="space-y-2">
      <Button
        type="button"
        variant="outline"
        className="w-full"
        onClick={onClick}
        disabled={isPending}
      >
        {isPending ? t("googleStarting") : t("continueWithGoogle")}
      </Button>
      {failed ? (
        <p role="alert" className="text-sm text-red-600">
          {t("errors.oauthStart")}
        </p>
      ) : null}
    </div>
  );
}

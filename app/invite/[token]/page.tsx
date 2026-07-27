import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { AcceptInvitation } from "@/components/organization/accept-invitation";
import { PublicShell } from "@/components/passports/public-shell";
import { Card, CardContent } from "@/components/ui/card";
import { previewInvitation } from "@/lib/organizations/invitations";
import { createClient } from "@/lib/supabase/server";

// Invitation links must never be indexed.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

/**
 * Invitation landing page.
 *
 * OPENING THIS PAGE NEVER ACCEPTS THE INVITATION. It only calls the read-only
 * `get_invitation_preview()` RPC, which creates no membership and returns only
 * the organization's display name, the offered role, a masked email and the
 * expiry. Acceptance requires the explicit button below, which posts a server
 * action — so a link prefetcher, an email scanner or a chat-app preview bot
 * cannot consume the invitation on the recipient's behalf.
 *
 * The raw token stays in the URL and in the server action's argument. It is
 * never written to localStorage, sessionStorage or a cookie. A signed-out
 * visitor is sent to /login (or /signup) with `redirectTo` pointing back here,
 * which the auth actions validate as an internal path before redirecting.
 */
export default async function InvitePage({ params }: PageProps<"/invite/[token]">) {
  const { token } = await params;
  const t = await getTranslations("invite");

  const preview = await previewInvitation(token);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (preview.state !== "valid") {
    return (
      <PublicShell>
        <Card>
          <CardContent className="space-y-3 py-10 text-center">
            <h1 className="text-xl font-bold">{t(`states.${preview.state}.title`)}</h1>
            <p className="text-sm text-ink-2">
              {t(`states.${preview.state}.body`)}
            </p>
            <Link
              href="/dashboard"
              className="inline-block pt-2 text-sm font-medium text-accent underline"
            >
              {t("goToApp")}
            </Link>
          </CardContent>
        </Card>
      </PublicShell>
    );
  }

  const returnPath = `/invite/${encodeURIComponent(token)}`;

  return (
    <PublicShell>
      <Card>
        <CardContent className="space-y-5 py-8">
          <div className="space-y-2 text-center">
            <h1 className="text-xl font-bold">
              {t("heading", { organization: preview.organization_name })}
            </h1>
            <p className="text-sm text-ink-2">
              {t("roleLine", { role: t(`roles.${preview.role}`) })}
            </p>
            <p className="text-sm text-ink-2">
              {t("sentTo")}{" "}
              <span dir="ltr" className="font-medium text-ink">
                {preview.email_masked}
              </span>
            </p>
          </div>

          {user ? (
            <AcceptInvitation token={token} signedInEmail={user.email ?? ""} />
          ) : (
            <div className="space-y-3">
              <p className="text-center text-sm text-ink-2">
                {t("signInPrompt")}
              </p>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Link
                  href={`/login?redirectTo=${encodeURIComponent(returnPath)}`}
                  className="inline-flex h-11 flex-1 items-center justify-center rounded-xl bg-accent px-4 text-sm font-bold text-on-accent glow-accent"
                >
                  {t("signIn")}
                </Link>
                <Link
                  href={`/signup?redirectTo=${encodeURIComponent(returnPath)}`}
                  className="inline-flex h-11 flex-1 items-center justify-center rounded-xl border border-line bg-surface-2 px-4 text-sm font-medium text-ink"
                >
                  {t("signUp")}
                </Link>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </PublicShell>
  );
}

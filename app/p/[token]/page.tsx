import type { Metadata } from "next";
import { PublicError } from "@/components/passports/public-error";
import { PublicPassportReport } from "@/components/passports/public-passport-report";
import { PublicShell } from "@/components/passports/public-shell";
import { getPublicPassport, isTokenOwner } from "@/lib/passports/public";
import { createClient } from "@/lib/supabase/server";

// Share links should not be indexed by search engines.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default async function PublicPassportPage({
  params,
}: PageProps<"/p/[token]">) {
  const { token } = await params;
  const result = await getPublicPassport(token);

  // Determine viewer context only for a valid passport (to drive the accept CTA).
  let loggedIn = false;
  let isOwner = false;
  if (result.state === "ok") {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    loggedIn = Boolean(user);
    isOwner = loggedIn ? await isTokenOwner(token) : false;
  }

  return (
    <PublicShell>
      {result.state === "ok" ? (
        <PublicPassportReport
          view={result.view}
          token={token}
          loggedIn={loggedIn}
          isOwner={isOwner}
        />
      ) : (
        <PublicError state={result.state} />
      )}
    </PublicShell>
  );
}

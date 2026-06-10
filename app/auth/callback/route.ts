import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * OAuth callback. Google redirects here with a `code` after the user grants
 * access; we exchange it for a Supabase session (the PKCE verifier lives in a
 * cookie set when the flow started) and then send the user to `next`.
 *
 * `next` is validated as an internal path to avoid open redirects, mirroring
 * `safeRedirectPath` in the auth actions.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get("code");

  const nextParam = searchParams.get("next");
  const next =
    nextParam && nextParam.startsWith("/") && !nextParam.startsWith("//")
      ? nextParam
      : "/dashboard";

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  // No code, or the exchange failed: bounce back to login with an error flag.
  return NextResponse.redirect(`${origin}/login?authError=oauth`);
}

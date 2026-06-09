import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { getSupabaseAnonKey, getSupabaseUrl } from "./env";

/** Routes that require an authenticated user. */
const PROTECTED_PREFIXES = ["/dashboard"];
/** Auth routes that an already-authenticated user should be bounced away from. */
const AUTH_PREFIXES = ["/login", "/signup"];

/**
 * Refreshes the Supabase auth session on every request and performs an
 * optimistic (cookie-only) auth redirect. This runs from `proxy.ts`.
 *
 * IMPORTANT: only an optimistic check is done here (reading the session from
 * the cookie). Real authorization still happens in Server Components/Actions
 * via the server client. See the Next.js auth guide ("Optimistic checks").
 */
export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(getSupabaseUrl(), getSupabaseAnonKey(), {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) =>
          request.cookies.set(name, value),
        );
        supabaseResponse = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          supabaseResponse.cookies.set(name, value, options),
        );
      },
    },
  });

  // Do not run code between createServerClient and getUser(): it refreshes
  // the token and rewrites the response cookies. Reordering can log users out.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const isAuthed = Boolean(user);
  const { pathname } = request.nextUrl;

  const isProtected = PROTECTED_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
  const isAuthRoute = AUTH_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );

  if (isProtected && !isAuthed) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("redirectTo", pathname);
    return NextResponse.redirect(url);
  }

  if (isAuthRoute && isAuthed) {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}

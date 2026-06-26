import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { getSupabaseAnonKey, getSupabaseUrl } from "./env";

/**
 * Routes that require an authenticated user. Must cover every route in the
 * `(app)` group: without this, an unauthenticated request to e.g. `/vehicles`
 * is NOT redirected here and instead reaches the Server Component, whose data
 * access throws NotAuthenticatedError → the error boundary shows "Something
 * went wrong" (the `(app)` layout's redirect races the page and loses). The
 * proxy redirect runs before rendering, so it wins.
 */
const PROTECTED_PREFIXES = [
  "/dashboard",
  "/vehicles",
  "/diagnose",
  "/scan",
  "/settings",
];
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

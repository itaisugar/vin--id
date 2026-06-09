import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { getSupabaseAnonKey, getSupabaseUrl } from "./env";

/**
 * Supabase client for use in Server Components, Server Actions, and Route
 * Handlers. In Next.js 16 `cookies()` is async, so this helper is async too.
 *
 * The `setAll` call is wrapped in try/catch because Server Components cannot
 * write cookies — in that context session refresh is handled by `proxy.ts`.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(getSupabaseUrl(), getSupabaseAnonKey(), {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options),
          );
        } catch {
          // Called from a Server Component — safe to ignore. The proxy
          // (middleware) refreshes the session cookies on every request.
        }
      },
    },
  });
}

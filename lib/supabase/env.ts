/**
 * Centralized, validated access to the public Supabase environment variables.
 *
 * These are read LAZILY (via functions, not module-level constants) so a
 * missing env var fails at request time with a clear error — NOT at module
 * evaluation, which would crash `next build` page-data collection. NEXT_PUBLIC_*
 * values are still inlined at build time for the browser bundle.
 *
 * Note: the project URL must be the bare origin (e.g. https://xxxx.supabase.co).
 * The `.env.local` value sometimes ships with a trailing `/rest/v1/`, which
 * breaks supabase-js (Auth/Realtime build their own paths). We defensively
 * strip it here so a misconfigured env does not silently break auth.
 */
export function getSupabaseUrl(): string {
  const rawUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!rawUrl) {
    throw new Error("Missing env var: NEXT_PUBLIC_SUPABASE_URL");
  }
  return rawUrl.replace(/\/rest\/v1\/?$/, "").replace(/\/$/, "");
}

export function getSupabaseAnonKey(): string {
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!key) {
    throw new Error("Missing env var: NEXT_PUBLIC_SUPABASE_ANON_KEY");
  }
  return key;
}

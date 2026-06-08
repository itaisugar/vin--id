/**
 * Centralized, validated access to the public Supabase environment variables.
 *
 * Note: the project URL must be the bare origin (e.g. https://xxxx.supabase.co).
 * The `.env.local` value sometimes ships with a trailing `/rest/v1/`, which
 * breaks supabase-js (Auth/Realtime build their own paths). We defensively
 * strip it here so a misconfigured env does not silently break auth.
 */
function normalizeSupabaseUrl(rawUrl: string | undefined): string {
  if (!rawUrl) {
    throw new Error("Missing env var: NEXT_PUBLIC_SUPABASE_URL");
  }
  return rawUrl.replace(/\/rest\/v1\/?$/, "").replace(/\/$/, "");
}

export const SUPABASE_URL = normalizeSupabaseUrl(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
);

export const SUPABASE_ANON_KEY = (() => {
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!key) {
    throw new Error("Missing env var: NEXT_PUBLIC_SUPABASE_ANON_KEY");
  }
  return key;
})();

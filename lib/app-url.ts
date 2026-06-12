import "server-only";

import { headers } from "next/headers";

/**
 * Thrown when no public base URL can be resolved in production (no
 * `APP_PUBLIC_URL`, no usable request headers, no `VERCEL_URL`). Callers should
 * handle this gracefully — never fall back to localhost in production.
 */
export class AppUrlNotConfiguredError extends Error {
  constructor() {
    super(
      "APP_PUBLIC_URL is not configured and the request host could not be determined.",
    );
    this.name = "AppUrlNotConfiguredError";
  }
}

const LOCAL_DEV_FALLBACK = "http://localhost:3000";

const trimTrailingSlash = (url: string) => url.replace(/\/+$/, "");

const isLocalHost = (host: string) =>
  host.startsWith("localhost") ||
  host.startsWith("127.0.0.1") ||
  host.startsWith("[::1]");

/**
 * Resolve the public base URL used to build absolute links (e.g. Passport
 * share links `/p/{token}`). Never hardcodes localhost in production.
 *
 * Resolution order:
 *  1. `APP_PUBLIC_URL` — explicit override; set this to the stable prod domain.
 *  2. Request headers (`x-forwarded-proto` / `x-forwarded-host` / `host`) —
 *     proxy-aware, works behind Vercel and reflects custom domains.
 *  3. `VERCEL_URL` — per-deployment host, as a last automatic signal.
 *  4. Development only: `http://localhost:3000`.
 *
 * In production, if none of 1–3 resolve, throws {@link AppUrlNotConfiguredError}
 * rather than silently emitting a localhost link.
 */
export async function getAppBaseUrl(): Promise<string> {
  // 1. Explicit, stable override.
  if (process.env.APP_PUBLIC_URL) {
    return trimTrailingSlash(process.env.APP_PUBLIC_URL);
  }

  // 2. Derive from the incoming request (proxy-aware). Only available inside a
  //    request scope (server component / server action / route handler).
  try {
    const h = await headers();
    const host = h.get("x-forwarded-host") ?? h.get("host");
    if (host) {
      const proto =
        h.get("x-forwarded-proto") ?? (isLocalHost(host) ? "http" : "https");
      return trimTrailingSlash(`${proto}://${host}`);
    }
  } catch {
    // headers() unavailable (called outside a request) — fall through.
  }

  // 3. Vercel system var (per-deployment host).
  if (process.env.VERCEL_URL) {
    return trimTrailingSlash(`https://${process.env.VERCEL_URL}`);
  }

  // 4. Local development only — never localhost in production.
  if (process.env.NODE_ENV !== "production") {
    return LOCAL_DEV_FALLBACK;
  }

  throw new AppUrlNotConfiguredError();
}

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

/** Where a resolved base URL came from (for safe, non-sensitive diagnostics). */
export type AppBaseUrlSource =
  | "APP_PUBLIC_URL"
  | "request-headers"
  | "VERCEL_URL"
  | "dev-fallback";

export interface ResolvedAppBaseUrl {
  /** The resolved base URL, or `null` if none could be resolved. */
  url: string | null;
  /** Which source produced it, or `null` when unresolved. */
  source: AppBaseUrlSource | null;
}

const isProduction = () => process.env.NODE_ENV === "production";

const trimTrailingSlash = (url: string) => url.replace(/\/+$/, "");

const isLocalHostname = (host: string) =>
  host === "localhost" ||
  host === "127.0.0.1" ||
  host === "::1" ||
  host === "[::1]";

const startsWithLocalHost = (host: string) =>
  host.startsWith("localhost") ||
  host.startsWith("127.0.0.1") ||
  host.startsWith("[::1]");

/** True when a full URL points at a loopback host (localhost/127.0.0.1/::1). */
function isLocalUrl(url: string): boolean {
  try {
    return isLocalHostname(new URL(url).hostname);
  } catch {
    return false;
  }
}

/**
 * Resolve the public base URL used to build absolute links (e.g. Passport
 * share links `/p/{token}`), returning both the URL and the source it came
 * from. Never returns a localhost URL in production — a loopback URL from any
 * source (including a misconfigured `APP_PUBLIC_URL=http://localhost:3000` on
 * the server) is rejected and the next source is tried.
 *
 * Resolution order:
 *  1. `APP_PUBLIC_URL` — explicit override; set this to the stable prod domain.
 *  2. Request headers (`x-forwarded-proto` / `x-forwarded-host` / `host`) —
 *     proxy-aware, works behind Vercel and reflects custom domains.
 *  3. `VERCEL_URL` — per-deployment host, as a last automatic signal.
 *  4. Development only: `http://localhost:3000`.
 */
export async function resolveAppBaseUrl(): Promise<ResolvedAppBaseUrl> {
  const candidates: { source: AppBaseUrlSource; url: string }[] = [];

  // 1. Explicit, stable override.
  if (process.env.APP_PUBLIC_URL) {
    candidates.push({
      source: "APP_PUBLIC_URL",
      url: trimTrailingSlash(process.env.APP_PUBLIC_URL),
    });
  }

  // 2. Derive from the incoming request (proxy-aware). Only available inside a
  //    request scope (server component / server action / route handler).
  try {
    const h = await headers();
    const host = h.get("x-forwarded-host") ?? h.get("host");
    if (host) {
      const proto =
        h.get("x-forwarded-proto") ??
        (startsWithLocalHost(host) ? "http" : "https");
      candidates.push({
        source: "request-headers",
        url: trimTrailingSlash(`${proto}://${host}`),
      });
    }
  } catch {
    // headers() unavailable (called outside a request) — skip this source.
  }

  // 3. Vercel system var (per-deployment host).
  if (process.env.VERCEL_URL) {
    candidates.push({
      source: "VERCEL_URL",
      url: trimTrailingSlash(`https://${process.env.VERCEL_URL}`),
    });
  }

  // 4. Local development only — never localhost in production.
  if (!isProduction()) {
    candidates.push({ source: "dev-fallback", url: LOCAL_DEV_FALLBACK });
  }

  for (const candidate of candidates) {
    // Strict production rule: a loopback URL is never a valid public link.
    if (isProduction() && isLocalUrl(candidate.url)) {
      console.warn(
        `[app-url] Ignoring base URL from ${candidate.source} in production: it points at localhost. ` +
          `Set APP_PUBLIC_URL to the production domain in Vercel and redeploy.`,
      );
      continue;
    }
    return { url: candidate.url, source: candidate.source };
  }

  return { url: null, source: null };
}

/**
 * Convenience wrapper around {@link resolveAppBaseUrl} that returns just the
 * URL string and throws {@link AppUrlNotConfiguredError} when none resolves.
 */
export async function getAppBaseUrl(): Promise<string> {
  const { url } = await resolveAppBaseUrl();
  if (!url) throw new AppUrlNotConfiguredError();
  return url;
}

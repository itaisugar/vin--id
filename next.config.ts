import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

const nextConfig: NextConfig = {
  // Pin the workspace root to this app directory. A stray lockfile exists one
  // level up (an accidental install), so without this Next.js infers the wrong
  // root. See https://nextjs.org/docs/app/api-reference/config/next-config-js/turbopack#root-directory
  turbopack: {
    root: import.meta.dirname,
  },
  // DEV-ONLY. Next.js 16 blocks cross-origin requests to dev resources
  // (`/_next/static/*`, `/_next/webpack-hmr`) unless the requesting host is
  // trusted. Only `localhost` is trusted by default, so opening the dev server
  // from a phone on the LAN (e.g. http://192.168.1.179:3000) returns 403 for
  // every JS chunk — the page renders but never hydrates, so no button responds.
  // Listing LAN hosts here restores hydration for on-device QA. This setting is
  // ignored by `next build`/`next start`, so it does NOT affect production trust
  // boundaries. Extend via ALLOWED_DEV_ORIGINS (comma-separated) without editing
  // this file. See https://nextjs.org/docs/app/api-reference/config/next-config-js/allowedDevOrigins
  allowedDevOrigins: [
    "192.168.1.179",
    ...(process.env.ALLOWED_DEV_ORIGINS?.split(",").map((s) => s.trim()).filter(Boolean) ?? []),
  ],
  // `sharp` is a native module used server-side to downscale scanned images
  // before sending them to the extraction provider. Keep it external so it is
  // required at runtime rather than bundled.
  serverExternalPackages: ["sharp"],
};

export default withNextIntl(nextConfig);

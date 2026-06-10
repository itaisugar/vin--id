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
  // `sharp` is a native module used server-side to downscale scanned images
  // before sending them to the extraction provider. Keep it external so it is
  // required at runtime rather than bundled.
  serverExternalPackages: ["sharp"],
};

export default withNextIntl(nextConfig);

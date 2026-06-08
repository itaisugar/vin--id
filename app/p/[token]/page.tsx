import type { Metadata } from "next";
import { PublicError } from "@/components/passports/public-error";
import { PublicPassportReport } from "@/components/passports/public-passport-report";
import { PublicShell } from "@/components/passports/public-shell";
import { getPublicPassport } from "@/lib/passports/public";

// Share links should not be indexed by search engines.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default async function PublicPassportPage({
  params,
}: PageProps<"/p/[token]">) {
  const { token } = await params;
  const result = await getPublicPassport(token);

  return (
    <PublicShell>
      {result.state === "ok" ? (
        <PublicPassportReport view={result.view} />
      ) : (
        <PublicError state={result.state} />
      )}
    </PublicShell>
  );
}

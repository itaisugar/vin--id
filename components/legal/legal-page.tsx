import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { PublicShell } from "@/components/passports/public-shell";

// TODO(legal): these are plain beta-stage summaries — have a legal professional
// review the Privacy Policy and Terms before any public (non-beta) launch.

/** Renders a simple legal document (privacy/terms) from the `legal.<ns>` keys. */
export async function LegalPage({ ns }: { ns: "privacy" | "terms" }) {
  const t = await getTranslations(`legal.${ns}`);
  const points = t.raw("points") as string[];

  return (
    <PublicShell>
      <article className="mx-auto max-w-2xl space-y-4">
        <div className="space-y-1">
          <Link
            href="/"
            className="inline-flex items-center gap-1 text-sm text-ink-2 hover:text-ink"
          >
            <span className="inline-block rtl:rotate-180">←</span> {t("home")}
          </Link>
          <h1 className="text-2xl font-extrabold tracking-tight">
            {t("title")}
          </h1>
          <p className="text-xs text-ink-3">{t("updated")}</p>
        </div>

        <p className="text-sm text-ink-2">{t("intro")}</p>

        <ul className="list-disc space-y-2 ps-5 text-sm">
          {points.map((point, i) => (
            <li key={i}>{point}</li>
          ))}
        </ul>

        <p className="rounded-xl border border-line bg-surface-2 p-3 text-xs text-ink-2">
          {t("betaNote")}
        </p>
      </article>
    </PublicShell>
  );
}

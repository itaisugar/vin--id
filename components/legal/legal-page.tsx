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
            className="text-sm text-muted-foreground hover:underline"
          >
            ← {t("home")}
          </Link>
          <h1 className="text-2xl font-bold">{t("title")}</h1>
          <p className="text-xs text-muted-foreground">{t("updated")}</p>
        </div>

        <p className="text-sm text-muted-foreground">{t("intro")}</p>

        <ul className="list-disc space-y-2 ps-5 text-sm">
          {points.map((point, i) => (
            <li key={i}>{point}</li>
          ))}
        </ul>

        <p className="rounded-md border border-border bg-muted p-3 text-xs text-muted-foreground">
          {t("betaNote")}
        </p>
      </article>
    </PublicShell>
  );
}

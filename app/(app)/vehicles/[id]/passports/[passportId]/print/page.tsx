import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { PassportPrintReport } from "@/components/passports/passport-print-report";
import { PrintButton } from "@/components/passports/print-button";
import { getPassport } from "@/lib/passports/service";

export default async function PassportPrintPage({
  params,
}: PageProps<"/vehicles/[id]/passports/[passportId]/print">) {
  const { id, passportId } = await params;
  const t = await getTranslations("passports.print");

  // Owner-only: getPassport is owner-scoped (RLS + owner filter).
  const passport = await getPassport(id, passportId);
  if (!passport) notFound();

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      {/* On-screen controls — hidden in the printout */}
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link
          href={`/vehicles/${id}/passports/${passportId}`}
          className="text-sm text-muted-foreground hover:underline"
        >
          ← {t("back")}
        </Link>
        <PrintButton />
      </div>

      <PassportPrintReport passport={passport} />
    </div>
  );
}

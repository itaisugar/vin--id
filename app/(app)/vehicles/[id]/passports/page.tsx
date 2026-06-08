import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { PassportCard } from "@/components/passports/passport-card";
import { listPassports } from "@/lib/passports/service";
import { getVehicleById } from "@/lib/vehicles/service";

export default async function PassportsListPage({
  params,
}: PageProps<"/vehicles/[id]/passports">) {
  const { id } = await params;
  const t = await getTranslations("passports");

  const vehicle = await getVehicleById(id);
  if (!vehicle) notFound();

  const passports = await listPassports(id);
  const vehicleTitle =
    [vehicle.make, vehicle.model].filter(Boolean).join(" ").trim();

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <Link
            href={`/vehicles/${id}`}
            className="text-sm text-muted-foreground hover:underline"
          >
            ← {vehicleTitle || t("backToVehicle")}
          </Link>
          <h1 className="text-2xl font-bold">{t("title")}</h1>
        </div>
        <Link
          href={`/vehicles/${id}/passports/new`}
          className="inline-flex h-10 shrink-0 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:opacity-90"
        >
          {t("create.cta")}
        </Link>
      </div>

      {passports.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border p-12 text-center">
          <p className="font-medium">{t("empty.title")}</p>
          <p className="max-w-sm text-sm text-muted-foreground">
            {t("empty.body")}
          </p>
          <Link
            href={`/vehicles/${id}/passports/new`}
            className="inline-flex h-10 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:opacity-90"
          >
            {t("create.cta")}
          </Link>
        </div>
      ) : (
        <div className="grid gap-3">
          {passports.map((passport) => (
            <PassportCard key={passport.id} vehicleId={id} passport={passport} />
          ))}
        </div>
      )}
    </div>
  );
}

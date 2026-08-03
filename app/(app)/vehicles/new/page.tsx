import { getTranslations } from "next-intl/server";
import { AddVehicleFlow } from "@/components/vehicles/add-vehicle-flow";
import { redirectDriversAway } from "@/lib/drivers/guard";

export default async function NewVehiclePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // Drivers have their own screen; Fleet queries return nothing for them.
  await redirectDriversAway();

  const t = await getTranslations("vehicles");

  // Optional deep-link (e.g. from onboarding) straight into a method.
  const raw = (await searchParams).method;
  const method =
    raw === "lookup" || raw === "scan" || raw === "manual" ? raw : undefined;

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-bold">{t("new.title")}</h1>
        <p className="text-sm text-ink-2">{t("new.subtitle")}</p>
      </div>
      <AddVehicleFlow cancelHref="/vehicles" initialMethod={method} />
    </div>
  );
}

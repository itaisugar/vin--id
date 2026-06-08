import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { createReminderAction } from "../actions";
import { ReminderForm } from "@/components/reminders/reminder-form";
import { getVehicleById } from "@/lib/vehicles/service";

export default async function NewReminderPage({
  params,
}: PageProps<"/vehicles/[id]/reminders/new">) {
  const { id } = await params;
  const t = await getTranslations("reminders");

  const vehicle = await getVehicleById(id);
  if (!vehicle) notFound();

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-bold">{t("new.title")}</h1>
        <p className="text-sm text-muted-foreground">{t("new.subtitle")}</p>
      </div>
      <ReminderForm
        mode="create"
        action={createReminderAction.bind(null, id)}
        cancelHref={`/vehicles/${id}/reminders`}
      />
    </div>
  );
}

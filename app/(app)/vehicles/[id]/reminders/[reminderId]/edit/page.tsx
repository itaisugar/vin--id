import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { updateReminderAction } from "../../actions";
import { ReminderForm } from "@/components/reminders/reminder-form";
import { getReminder } from "@/lib/reminders/service";
import { reminderToFormValues } from "@/lib/reminders/types";
import { getVehicleById } from "@/lib/vehicles/service";

export default async function EditReminderPage({
  params,
}: PageProps<"/vehicles/[id]/reminders/[reminderId]/edit">) {
  const { id, reminderId } = await params;
  const t = await getTranslations("reminders");

  const vehicle = await getVehicleById(id);
  if (!vehicle) notFound();

  const reminder = await getReminder(id, reminderId);
  if (!reminder) notFound();

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <h1 className="text-2xl font-bold">{t("edit.title")}</h1>
      <ReminderForm
        mode="edit"
        defaultValues={reminderToFormValues(reminder)}
        action={updateReminderAction.bind(null, id, reminderId)}
        cancelHref={`/vehicles/${id}/reminders`}
      />
    </div>
  );
}

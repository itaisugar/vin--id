"use client";

import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { DeleteReminderButton } from "@/components/reminders/delete-reminder-button";
import { ReminderQuickActions } from "@/components/reminders/reminder-actions";
import { ReminderStatusBadge } from "@/components/reminders/reminder-status-badge";
import { UrgencyBadge } from "@/components/reminders/urgency-badge";
import {
  ACTIVE_STATUS,
  deriveEffectiveUrgency,
  type Reminder,
} from "@/lib/reminders/types";
import type { MileageUnit } from "@/lib/vehicles/types";

export function ReminderListItem({
  vehicleId,
  reminder,
  currentMileage,
  mileageUnit,
}: {
  vehicleId: string;
  reminder: Reminder;
  currentMileage: number | null;
  mileageUnit: MileageUnit;
}) {
  const t = useTranslations("reminders");
  const tUnits = useTranslations("vehicles");
  const locale = useLocale();

  const isActive = reminder.status === ACTIVE_STATUS;
  const effectiveUrgency = deriveEffectiveUrgency(reminder, currentMileage);

  const dueDate = reminder.due_date
    ? new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(
        new Date(reminder.due_date),
      )
    : null;

  const meta = [
    dueDate ? `${t("fields.dueDate")}: ${dueDate}` : null,
    reminder.due_mileage != null
      ? `${t("fields.dueMileage")}: ${reminder.due_mileage.toLocaleString(locale)} ${tUnits(`units.${mileageUnit}`)}`
      : null,
  ].filter(Boolean);

  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="muted">{t(`types.${reminder.reminder_type}`)}</Badge>
            {isActive ? (
              <UrgencyBadge urgency={effectiveUrgency} />
            ) : (
              <ReminderStatusBadge status={reminder.status} />
            )}
          </div>
          <p className="text-sm font-medium">
            {reminder.title ?? t("untitled")}
          </p>
          {reminder.description ? (
            <p className="whitespace-pre-wrap text-sm text-muted-foreground">
              {reminder.description}
            </p>
          ) : null}
          {meta.length > 0 ? (
            <p className="text-xs text-muted-foreground">{meta.join(" · ")}</p>
          ) : null}
        </div>

        <div className="flex shrink-0 flex-col items-end gap-1">
          {isActive ? (
            <ReminderQuickActions
              vehicleId={vehicleId}
              reminderId={reminder.id}
            />
          ) : null}
          <div className="flex items-center gap-1">
            <Link
              href={`/vehicles/${vehicleId}/reminders/${reminder.id}/edit`}
              className="inline-flex h-8 items-center justify-center rounded-md px-3 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted"
            >
              {t("edit.action")}
            </Link>
            <DeleteReminderButton vehicleId={vehicleId} reminderId={reminder.id} />
          </div>
        </div>
      </div>
    </Card>
  );
}

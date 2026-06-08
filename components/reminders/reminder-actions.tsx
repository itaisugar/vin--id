"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import {
  completeReminderAction,
  dismissReminderAction,
} from "@/app/(app)/vehicles/[id]/reminders/actions";
import { Button } from "@/components/ui/button";

/** Quick "complete" / "dismiss" actions for an active reminder. */
export function ReminderQuickActions({
  vehicleId,
  reminderId,
}: {
  vehicleId: string;
  reminderId: string;
}) {
  const t = useTranslations("reminders");
  const [isPending, startTransition] = React.useTransition();

  const run = (fn: () => Promise<unknown>) =>
    startTransition(() => {
      void fn();
    });

  return (
    <div className="flex items-center gap-1">
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={isPending}
        onClick={() => run(() => completeReminderAction(vehicleId, reminderId))}
      >
        {t("actions.complete")}
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={isPending}
        onClick={() => run(() => dismissReminderAction(vehicleId, reminderId))}
      >
        {t("actions.dismiss")}
      </Button>
    </div>
  );
}

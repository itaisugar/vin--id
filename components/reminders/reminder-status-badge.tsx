import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import type { ReminderStatus } from "@/lib/reminders/types";

const TONE: Record<ReminderStatus, "neutral" | "muted"> = {
  pending: "neutral", // shown as "Active"
  completed: "muted",
  dismissed: "muted",
};

export function ReminderStatusBadge({ status }: { status: ReminderStatus }) {
  const t = useTranslations("reminders");
  return <Badge tone={TONE[status]}>{t(`statuses.${status}`)}</Badge>;
}

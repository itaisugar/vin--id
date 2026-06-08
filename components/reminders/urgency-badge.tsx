import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import type { Urgency } from "@/lib/reminders/types";

const TONE: Record<Urgency, "success" | "warning" | "danger"> = {
  green: "success",
  orange: "warning",
  red: "danger",
};

/** Shows the (effective) urgency. Pass the derived value for live state. */
export function UrgencyBadge({ urgency }: { urgency: Urgency }) {
  const t = useTranslations("reminders");
  return <Badge tone={TONE[urgency]}>{t(`urgencies.${urgency}`)}</Badge>;
}

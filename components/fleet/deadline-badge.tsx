import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { DEADLINE_TONE, type DeadlineState } from "@/lib/fleet/dates";

/**
 * "Overdue" / "Due soon" / "Upcoming" for a date or KM deadline.
 * Always renders the text label; colour is supplementary only.
 */
export function DeadlineBadge({
  state,
  className,
}: {
  state: DeadlineState;
  className?: string;
}) {
  const t = useTranslations("fleet.deadline");
  return (
    <Badge tone={DEADLINE_TONE[state]} className={className}>
      {t(state)}
    </Badge>
  );
}

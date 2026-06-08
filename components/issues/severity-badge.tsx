import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import type { IssueSeverity } from "@/lib/issues/types";

const TONE: Record<
  IssueSeverity,
  "neutral" | "success" | "warning" | "danger" | "muted"
> = {
  info: "muted",
  monitor: "neutral",
  diy_simple: "neutral",
  mechanic_recommended: "warning",
  urgent: "warning",
  stop_immediately: "danger",
};

export function SeverityBadge({ severity }: { severity: IssueSeverity }) {
  const t = useTranslations("issues");
  return <Badge tone={TONE[severity]}>{t(`severities.${severity}`)}</Badge>;
}

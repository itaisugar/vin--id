import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import type { SafetyLevel } from "@/lib/diagnosis/types";

const TONE: Record<
  SafetyLevel,
  "neutral" | "success" | "warning" | "danger" | "muted"
> = {
  info: "muted",
  monitor: "neutral",
  diy_simple: "neutral",
  mechanic_recommended: "warning",
  urgent: "warning",
  stop_immediately: "danger",
};

export function SafetyBadge({ level }: { level: SafetyLevel }) {
  const t = useTranslations("diagnose");
  return <Badge tone={TONE[level]}>{t(`safetyLevels.${level}`)}</Badge>;
}

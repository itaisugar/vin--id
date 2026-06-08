import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import type { TrustLevel } from "@/lib/maintenance/types";

const TONE: Record<TrustLevel, "neutral" | "success" | "warning" | "muted"> = {
  user_entered: "muted",
  document_backed: "success",
  ai_extracted: "neutral",
  mechanic_verified: "success",
  external_source: "warning",
};

export function TrustLabelBadge({ level }: { level: TrustLevel }) {
  const t = useTranslations("maintenance");
  return <Badge tone={TONE[level]}>{t(`trustLevels.${level}`)}</Badge>;
}

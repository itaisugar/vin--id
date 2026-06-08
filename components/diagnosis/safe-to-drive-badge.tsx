import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import type { SafeToDrive } from "@/lib/diagnosis/types";

const TONE: Record<SafeToDrive, "success" | "danger" | "muted"> = {
  yes: "success",
  no: "danger",
  unknown: "muted",
};

export function SafeToDriveBadge({ value }: { value: SafeToDrive }) {
  const t = useTranslations("diagnose");
  return (
    <Badge tone={TONE[value]}>
      {t("safeToDrive.label")}: {t(`safeToDrive.${value}`)}
    </Badge>
  );
}

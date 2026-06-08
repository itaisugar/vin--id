import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import type { IssueStatus } from "@/lib/issues/types";

const TONE: Record<IssueStatus, "neutral" | "success" | "warning" | "muted"> = {
  open: "warning",
  monitoring: "neutral",
  resolved: "success",
};

export function IssueStatusBadge({ status }: { status: IssueStatus }) {
  const t = useTranslations("issues");
  return <Badge tone={TONE[status]}>{t(`statuses.${status}`)}</Badge>;
}

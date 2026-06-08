import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import type { PassportStatus } from "@/lib/passports/types";

const TONE: Record<
  PassportStatus,
  "neutral" | "success" | "warning" | "danger" | "muted"
> = {
  draft: "muted",
  active: "success",
  revoked: "danger",
  expired: "warning",
  accepted: "neutral",
};

export function PassportStatusBadge({ status }: { status: PassportStatus }) {
  const t = useTranslations("passports");
  return <Badge tone={TONE[status]}>{t(`statuses.${status}`)}</Badge>;
}

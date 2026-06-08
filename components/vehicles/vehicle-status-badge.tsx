import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import type { VehicleStatus } from "@/lib/vehicles/types";

const TONE: Record<VehicleStatus, "success" | "muted" | "warning"> = {
  active: "success",
  archived: "muted",
  sold: "warning",
};

export function VehicleStatusBadge({ status }: { status: VehicleStatus }) {
  const t = useTranslations("vehicles");
  return <Badge tone={TONE[status]}>{t(`status.${status}`)}</Badge>;
}

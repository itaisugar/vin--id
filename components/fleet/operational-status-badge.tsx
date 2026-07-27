import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import {
  OPERATIONAL_STATUS_TONE,
  type OperationalStatus,
} from "@/lib/fleet/types";

/**
 * Operational status ("can this vehicle work today?").
 *
 * ACCESSIBILITY: the translated text label is always rendered — colour is only
 * a secondary cue, never the sole carrier of meaning.
 *
 * Distinct from `VehicleStatusBadge`, which shows the LIFECYCLE status
 * (active / archived / sold). Both can appear on the same vehicle.
 */
export function OperationalStatusBadge({
  status,
  className,
}: {
  status: OperationalStatus;
  className?: string;
}) {
  const t = useTranslations("fleet.status");
  return (
    <Badge tone={OPERATIONAL_STATUS_TONE[status]} className={className}>
      {t(status)}
    </Badge>
  );
}

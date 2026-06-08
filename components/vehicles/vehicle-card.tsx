import Link from "next/link";
import { useTranslations } from "next-intl";
import { Card } from "@/components/ui/card";
import { CarIcon } from "@/components/icons";
import { VehicleStatusBadge } from "@/components/vehicles/vehicle-status-badge";
import type { Vehicle } from "@/lib/vehicles/types";

export function VehicleCard({ vehicle }: { vehicle: Vehicle }) {
  const t = useTranslations("vehicles");

  const title = [vehicle.make, vehicle.model].filter(Boolean).join(" ").trim();

  return (
    <Link
      href={`/vehicles/${vehicle.id}`}
      className="block rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
    >
      <Card className="flex items-center gap-4 p-4 transition-colors hover:bg-muted">
        <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted">
          {vehicle.photo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={vehicle.photo_url}
              alt=""
              className="h-full w-full object-cover"
            />
          ) : (
            <CarIcon className="h-6 w-6 text-muted-foreground" />
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate font-medium">
              {title || t("untitled")}
            </p>
            <VehicleStatusBadge status={vehicle.status} />
          </div>
          <p className="truncate text-sm text-muted-foreground">
            {[
              vehicle.year ?? null,
              vehicle.current_mileage != null
                ? `${vehicle.current_mileage.toLocaleString()} ${t(`units.${vehicle.mileage_unit}`)}`
                : null,
            ]
              .filter(Boolean)
              .join(" · ") || t("noDetails")}
          </p>
        </div>
      </Card>
    </Link>
  );
}

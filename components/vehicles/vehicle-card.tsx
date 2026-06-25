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
      className="block rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
    >
      <Card className="flex items-center gap-4 p-4 transition active:scale-[.99] hover:bg-surface-2">
        <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-surface-2">
          {vehicle.photo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={vehicle.photo_url}
              alt=""
              className="h-full w-full object-cover"
            />
          ) : (
            <CarIcon className="h-6 w-6 text-ink-3" />
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate font-semibold">{title || t("untitled")}</p>
            <VehicleStatusBadge status={vehicle.status} />
          </div>
          <p className="truncate text-sm text-ink-2">
            {vehicle.year != null ? <span className="num">{vehicle.year}</span> : null}
            {vehicle.year != null && vehicle.current_mileage != null ? " · " : null}
            {vehicle.current_mileage != null ? (
              <>
                <span className="num">
                  {vehicle.current_mileage.toLocaleString()}
                </span>{" "}
                {t(`units.${vehicle.mileage_unit}`)}
              </>
            ) : null}
            {vehicle.year == null && vehicle.current_mileage == null
              ? t("noDetails")
              : null}
          </p>
        </div>

        <span aria-hidden className="shrink-0 text-ink-3 rtl:rotate-180">
          ›
        </span>
      </Card>
    </Link>
  );
}

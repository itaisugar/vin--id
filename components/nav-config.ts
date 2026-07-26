import type { ComponentType, SVGProps } from "react";
import {
  CarIcon,
  DashboardIcon,
  DiagnoseIcon,
  SettingsIcon,
} from "@/components/icons";

export interface NavItem {
  /** Translation key under `nav`. */
  key: "dashboard" | "vehicles" | "diagnose" | "settings" | "myVehicle";
  href: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  enabled: boolean;
}

// Vehicle Passport is per-vehicle (under /vehicles/[id]/passports), so it is
// reached from a vehicle — not a top-level nav item.
export const navItems: NavItem[] = [
  { key: "dashboard", href: "/dashboard", icon: DashboardIcon, enabled: true },
  { key: "vehicles", href: "/vehicles", icon: CarIcon, enabled: true },
  { key: "diagnose", href: "/diagnose", icon: DiagnoseIcon, enabled: true },
  { key: "settings", href: "/settings", icon: SettingsIcon, enabled: true },
];

/**
 * Navigation for the `driver` role.
 *
 * Fleet Dashboard, Vehicles and Diagnose are absent because a driver cannot read
 * the tables behind them: the Fleet screens would render as empty shells. This
 * list is presentation only — the database, not the sidebar, is what denies the
 * data.
 */
export const driverNavItems: NavItem[] = [
  { key: "myVehicle", href: "/my-vehicle", icon: CarIcon, enabled: true },
  { key: "settings", href: "/settings", icon: SettingsIcon, enabled: true },
];

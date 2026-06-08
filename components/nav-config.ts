import type { ComponentType, SVGProps } from "react";
import {
  CarIcon,
  DashboardIcon,
  DiagnoseIcon,
  SettingsIcon,
} from "@/components/icons";

export interface NavItem {
  /** Translation key under `nav`. */
  key: "dashboard" | "vehicles" | "diagnose" | "settings";
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

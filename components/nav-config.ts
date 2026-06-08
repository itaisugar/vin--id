import type { ComponentType, SVGProps } from "react";
import {
  CarIcon,
  DashboardIcon,
  PassportIcon,
  SettingsIcon,
} from "@/components/icons";

export interface NavItem {
  /** Translation key under `nav`. */
  key: "dashboard" | "vehicles" | "passport" | "settings";
  href: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  /** Disabled items are placeholders for features not yet built (Phase 1). */
  enabled: boolean;
}

export const navItems: NavItem[] = [
  { key: "dashboard", href: "/dashboard", icon: DashboardIcon, enabled: true },
  { key: "vehicles", href: "/vehicles", icon: CarIcon, enabled: true },
  { key: "passport", href: "/passport", icon: PassportIcon, enabled: false },
  { key: "settings", href: "/settings", icon: SettingsIcon, enabled: false },
];

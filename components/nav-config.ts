import type { ComponentType, SVGProps } from "react";
import {
  CarIcon,
  DashboardIcon,
  DiagnoseIcon,
  SettingsIcon,
  TeamIcon,
} from "@/components/icons";

export interface NavItem {
  /** Translation key under `nav`. */
  key:
    | "dashboard"
    | "vehicles"
    | "diagnose"
    | "settings"
    | "myVehicle"
    | "teamAccess";
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

/**
 * Team & Access — member and invitation management.
 *
 * DESKTOP SIDEBAR ONLY. The mobile bar has exactly five slots (four items plus
 * the scanner FAB) and a sixth would not fit at 320px, so on a phone this screen
 * keeps its existing route in from Settings, under the same name.
 *
 * Shown only when `canManageOrganization(role)` — owner and admin. That is not a
 * cosmetic choice: `list_organization_members()` and every invitation policy
 * require `is_org_admin()`, so a fleet_manager or viewer would reach a screen
 * that can only tell them they may not use it. Hiding it is presentation; the
 * route, the service layer and RLS each still enforce the rule independently.
 */
export const teamAccessNavItem: NavItem = {
  key: "teamAccess",
  href: "/organization",
  icon: TeamIcon,
  enabled: true,
};

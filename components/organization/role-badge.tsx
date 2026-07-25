"use client";

import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import type { OrgRole } from "@/lib/organizations/types";

const toneByRole: Record<OrgRole, "neutral" | "success" | "warning" | "muted"> =
  {
    owner: "neutral",
    admin: "success",
    fleet_manager: "warning",
    viewer: "muted",
  };

/** Role chip. Labels are translated; the raw role value is never displayed. */
export function RoleBadge({ role }: { role: OrgRole }) {
  const t = useTranslations("organization.roles");
  return <Badge tone={toneByRole[role]}>{t(role)}</Badge>;
}

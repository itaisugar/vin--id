"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ONBOARDED_COOKIE } from "@/lib/onboarding";

/** Internal paths only (allow a query string) — never an open redirect. */
function safeTarget(value: string | undefined): string {
  if (typeof value === "string" && value.startsWith("/") && !value.startsWith("//")) {
    return value;
  }
  return "/dashboard";
}

/**
 * Mark onboarding complete and (optionally) go to the chosen next action.
 * Called with a target for Skip / Personal / Join, and with no target when the
 * create-organization form will perform its own redirect.
 */
export async function completeOnboarding(target?: string): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(ONBOARDED_COOKIE, "1", {
    path: "/",
    maxAge: 60 * 60 * 24 * 365, // 1 year
    sameSite: "lax",
  });
  if (target !== undefined) redirect(safeTarget(target));
}

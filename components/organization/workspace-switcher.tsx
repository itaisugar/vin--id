"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { switchWorkspaceAction } from "@/app/(app)/settings/workspace-actions";
import { RoleBadge } from "@/components/organization/role-badge";
import type { WorkspaceSummary } from "@/lib/organizations/service";

/**
 * Minimal workspace selector — the smallest thing that proves the foundation
 * works end to end.
 *
 * This is deliberately NOT the final design. It is a list of the workspaces the
 * user actually belongs to, each with the role they hold there, and a button to
 * make one active. The eventual switcher belongs in the app chrome; putting it
 * there now would be a navigation redesign, which this task excludes.
 *
 * `workspaces` comes from `list_my_workspaces()`, which returns only the
 * caller's own memberships — an organization the user cannot access is not
 * merely hidden here, it is never sent. Selecting one posts to a server action
 * that re-verifies membership in the database.
 */
export function WorkspaceSwitcher({
  workspaces,
}: {
  workspaces: WorkspaceSummary[];
}) {
  const t = useTranslations("workspace");
  const [state, formAction, isPending] = React.useActionState(
    switchWorkspaceAction,
    undefined,
  );

  // A user always has at least their personal workspace, so an empty list means
  // something is wrong rather than "nothing to show".
  if (workspaces.length === 0) {
    return <p className="text-sm text-ink-2">{t("none")}</p>;
  }

  return (
    <div className="space-y-3">
      <ul className="grid grid-cols-[minmax(0,1fr)] gap-2">
        {workspaces.map((w) => (
          <li key={w.organizationId}>
            <div
              className={`flex flex-wrap items-center justify-between gap-x-3 gap-y-2 rounded-xl border p-3 ${
                w.isActive
                  ? "border-accent/40 bg-accent/8"
                  : "border-line bg-surface-2"
              }`}
            >
              <div className="min-w-0 space-y-0.5">
                <p className="flex flex-wrap items-center gap-2">
                  <span className="min-w-0 break-words text-sm font-semibold text-ink">
                    {w.kind === "personal" ? t("personal") : w.name}
                  </span>
                  {w.isActive ? (
                    <span className="shrink-0 rounded-full bg-accent/15 px-2 py-0.5 text-[11px] font-semibold text-accent">
                      {t("active")}
                    </span>
                  ) : null}
                </p>
                <p className="text-xs text-ink-3">
                  {w.kind === "personal" ? t("personalHelp") : t("businessHelp")}
                </p>
              </div>

              <div className="flex shrink-0 items-center gap-2">
                <RoleBadge role={w.role} />
                {w.isActive ? null : (
                  <form action={formAction}>
                    <input
                      type="hidden"
                      name="organizationId"
                      value={w.organizationId}
                    />
                    <button
                      type="submit"
                      disabled={isPending}
                      className="inline-flex h-9 items-center justify-center rounded-xl border border-line bg-surface px-3 text-sm font-medium transition hover:bg-surface-2 disabled:opacity-60"
                    >
                      {isPending ? t("switching") : t("switch")}
                    </button>
                  </form>
                )}
              </div>
            </div>
          </li>
        ))}
      </ul>

      {state?.error ? (
        <p role="alert" className="text-sm text-danger">
          {t(`errors.${state.error}`)}
        </p>
      ) : null}
    </div>
  );
}

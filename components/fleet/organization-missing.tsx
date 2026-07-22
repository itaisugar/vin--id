import { getTranslations } from "next-intl/server";

/**
 * Shown when a signed-in user has no organization.
 *
 * This should be unreachable — the signup trigger provisions an organization
 * and the Phase 1 migration backfilled every existing profile. It exists
 * because the alternative (silently falling back to some other organization)
 * would be a cross-tenant data leak, so "no organization" must fail loudly and
 * visibly rather than degrade.
 *
 * No raw database error is surfaced to the user.
 */
export async function OrganizationMissing() {
  const t = await getTranslations("fleet.noOrganization");

  return (
    <div className="rounded-2xl border border-warn/25 bg-warn/10 p-6">
      <h1 className="text-base font-semibold text-warn">{t("title")}</h1>
      <p className="mt-2 text-sm text-ink-2">{t("body")}</p>
      <p className="mt-3 text-xs text-ink-3">{t("hint")}</p>
    </div>
  );
}

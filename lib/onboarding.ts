/**
 * Onboarding completion is stored in this cookie (a lightweight, no-migration
 * approach, matching the locale cookie). Once set — by finishing a path or
 * skipping — the onboarding page redirects straight to the app, so a returning
 * user is never shown onboarding again.
 */
export const ONBOARDED_COOKIE = "vinid_onboarded";

#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-unused-expressions --
   Deliberate `cond ? P(msg) : F(msg)` assertion style; both branches log+tally. */
/**
 * Mobile interaction release-blocker — regression (OFFLINE, structural).
 *
 * Root cause (verified on-device + empirically): Next.js 16 returns 403 for
 * cross-origin dev resources (`/_next/static/*`) when the dev server is opened
 * from a LAN host not in `allowedDevOrigins`, so the phone downloads the HTML
 * but no JS chunks → nothing hydrates → every client control (all three Add
 * Vehicle buttons AND the language toggle) ignores taps. Desktop `localhost`
 * is trusted by default, so it worked.
 *
 * The fix is a DEV-ONLY `allowedDevOrigins` entry; the components themselves are
 * already correct interactive elements. These assertions lock in the fix and
 * guard against the components regressing into non-hydrating / non-interactive
 * markup. No automated touch validation is performed (no browser here) — the
 * real-device retest is manual (see docs).
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve as resolvePath } from "node:path";

let fails = 0, passes = 0;
const P = (m) => { passes++; console.log(`  PASS  ${m}`); };
const F = (m) => { fails++; console.error(`  FAIL  ${m}`); };
const section = (t) => console.log(`\n— ${t} —`);
const REPO = resolvePath(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (p) => readFileSync(resolvePath(REPO, p), "utf8");

section("1. Dev-origin fix (the shared root cause)");
{
  const cfg = read("next.config.ts");
  cfg.includes("allowedDevOrigins") ? P("next.config declares allowedDevOrigins") : F("no allowedDevOrigins");
  cfg.includes("192.168.1.179") ? P("LAN QA host is allowed for dev resources") : F("LAN host not allowed");
  cfg.includes("ALLOWED_DEV_ORIGINS") ? P("extensible via ALLOWED_DEV_ORIGINS env (no file edit needed)") : F("not env-extensible");
  // Must remain dev-only: allowedDevOrigins is a dev config; ensure we didn't
  // touch production trust (no CORS '*', no disabled origin checks).
  !/Access-Control-Allow-Origin\s*[:=]\s*["'`]\*/.test(cfg) ? P("no wildcard CORS added") : F("wildcard CORS present");
}

section("2. Add Vehicle method controls are hydratable interactive elements");
{
  const src = read("components/vehicles/add-vehicle-flow.tsx");
  // Exactly three method buttons wired to the state machine.
  for (const step of ['setStep("lookup")', 'setStep("scan")', 'setStep("manual")']) {
    src.includes(step) ? P(`method transition present: ${step}`) : F(`missing ${step}`);
  }
  // Real <button type="button"> controls, not div-with-onClick.
  const buttonCount = (src.match(/type="button"/g) || []).length;
  buttonCount >= 3 ? P(`renders >=3 real <button type="button"> controls (${buttonCount})`) : F(`too few button controls (${buttonCount})`);
  !/<div[^>]*onClick=/.test(src) ? P("no onClick on non-interactive <div>") : F("onClick on a <div>");
  // The method buttons must not be disabled (they gate the whole flow).
  !/setStep\("(lookup|scan|manual)"\)[^}]*\bdisabled\b/.test(src) ? P("method buttons are not disabled") : F("a method button is disabled");
}

section("3. Language toggle is a hydratable interactive element");
{
  const src = read("components/language-switcher.tsx");
  src.includes('"use client"') ? P("language switcher is a client component") : F("not a client component");
  /<button[\s\S]*type="button"[\s\S]*onClick=\{\(\) => setOpen/.test(src) ? P("trigger is a real <button> with onClick") : F("trigger not a proper button");
  src.includes("aria-label") && src.includes('aria-haspopup="menu"') ? P("trigger is screen-reader labelled + has menu semantics") : F("missing a11y semantics");
  src.includes("setLocale(") ? P("selecting a locale invokes setLocale") : F("no setLocale call");
  !/<div[^>]*onClick=/.test(src) ? P("no onClick on non-interactive <div>") : F("onClick on a <div>");
}

section("4. Locale + direction + cookie (works on HTTP LAN and HTTPS prod)");
{
  const cfg = read("i18n/config.ts");
  /he:\s*"rtl"/.test(cfg) ? P("he → rtl in localeDirection") : F("he not rtl");
  /en:\s*"ltr"/.test(cfg) ? P("en → ltr in localeDirection") : F("en not ltr");
  const layout = read("app/layout.tsx");
  layout.includes("dir={dir}") ? P("root layout applies dir from locale") : F("layout does not set dir");
  const actions = read("i18n/actions.ts");
  actions.includes('sameSite: "lax"') ? P("locale cookie is SameSite=Lax (works cross-device)") : F("locale cookie SameSite");
  // A hardcoded Secure flag would drop the cookie over HTTP LAN QA; must be absent
  // (production HTTPS gets Secure from the platform/browser, not hardcoded here).
  !/secure:\s*true/i.test(actions) ? P("no hardcoded Secure on the locale cookie (HTTP LAN QA works)") : F("hardcoded Secure cookie");
}

section("5. No desktop-only masking of the defect");
{
  // Guard against 'hiding' the fix behind a desktop-only media query on the
  // method controls or the toggle (e.g. hidden md:block on the buttons).
  const flow = read("components/vehicles/add-vehicle-flow.tsx");
  !/className="[^"]*\bhidden\b[^"]*"[^>]*onClick=\{\(\) => setStep/.test(flow)
    ? P("method buttons are not hidden on mobile") : F("method buttons hidden on mobile");
}

console.log(`\n${fails === 0 ? "OK" : "FAILED"} — ${passes} passed, ${fails} failed`);
process.exit(fails === 0 ? 0 : 1);

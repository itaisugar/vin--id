#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-unused-expressions --
   Deliberate `cond ? P(msg) : F(msg)` assertion style; both branches log+tally. */
/**
 * Private-first onboarding — regression (OFFLINE, structural).
 *
 * Proves the product correction: onboarding is a two-step Private-first flow
 * (Welcome → Add first vehicle) with NO mode selection, NO join/create surfaces,
 * NO invitation-token input; invitation-origin sign-ups keep their redirectTo;
 * the completion cookie is never used for authorization; and the dashboard
 * checklist stays a separate count-derived setup tracker.
 *
 * No browser/device automation — a real-device visual pass is still required.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve as resolvePath, join } from "node:path";

let fails = 0, passes = 0;
const P = (m) => { passes++; console.log(`  PASS  ${m}`); };
const F = (m) => { fails++; console.error(`  FAIL  ${m}`); };
const section = (t) => console.log(`\n— ${t} —`);
const REPO = resolvePath(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (p) => readFileSync(resolvePath(REPO, p), "utf8");

const flow = read("components/onboarding/onboarding-flow.tsx");
const authForm = read("app/(auth)/auth-form.tsx");
const authActions = read("app/(auth)/actions.ts");
const onbActions = read("app/onboarding/actions.ts");
const onbPage = read("app/onboarding/page.tsx");
const addFlow = read("components/vehicles/add-vehicle-flow.tsx");
const newPage = read("app/(app)/vehicles/new/page.tsx");
const checklist = read("components/dashboard/onboarding-checklist.tsx");

section("1-2. Welcome first, CTA advances to vehicle step");
flow.includes('useState<Step>("welcome")') ? P("initial step is welcome") : F("welcome not first");
flow.includes('setStep("vehicle")') ? P("CTA advances to the vehicle step") : F("no advance to vehicle");
/Step\s*=\s*"welcome"\s*\|\s*"vehicle"/.test(flow) ? P("exactly two steps (welcome | vehicle)") : F("step union is not two-step");
/const TOTAL = 2/.test(flow) ? P("gauge total is 2 (no fake high step count)") : F("TOTAL is not 2");

section("3-6. Exactly three vehicle methods, correct deep links");
const links = [...flow.matchAll(/\/vehicles\/new\?method=(lookup|scan|manual)/g)].map((m) => m[1]);
links.length === 3 ? P("exactly three method deep links") : F(`found ${links.length} method links`);
["lookup", "scan", "manual"].forEach((m) =>
  links.includes(m) ? P(`method link present: ?method=${m}`) : F(`missing ?method=${m}`));
addFlow.includes("initialMethod") ? P("Add Vehicle flow honors initialMethod") : F("no initialMethod support");
newPage.includes("method") && /\?\s*Record<|searchParams/.test(newPage) ? P("/vehicles/new reads the method query") : F("new page ignores method");

section("7. Skip / later complete onboarding and reach Dashboard");
(flow.match(/go\("\/dashboard"\)/g) || []).length >= 1 ? P("skip/later route to /dashboard") : F("no /dashboard route");
onbActions.includes("cookies()") && /redirect\(safeTarget/.test(onbActions) ? P("completeOnboarding sets cookie + redirects to target") : F("completeOnboarding wiring");

section("8-10. Mode / Create-org / invitation input removed from onboarding");
!/"mode"|ModeStep|How will you use/.test(flow) ? P("no Choose-mode screen") : F("mode selection still present");
!flow.includes("CreateOrganizationForm") ? P("CreateOrganizationForm not imported in onboarding") : F("create-org form still embedded");
// No token parsing, no invite navigation, and no text input at all in the flow.
!/parseInviteToken|inviteInput|setInviteInput|\/invite\/\$\{/.test(flow) && !/components\/ui\/input/.test(flow)
  ? P("no invitation token/link input in onboarding (no text input at all)") : F("invitation input still present");
{
  const en = JSON.parse(read("messages/en.json")).onboarding;
  !en.mode && !en.join && !en.create ? P("onboarding messages drop mode/join/create") : F("stale mode/join/create keys");
}

section("11. Invitation-origin sign-up preserves redirectTo");
!/isLogin && redirectTo/.test(authForm) && /\{redirectTo \?/.test(authForm)
  ? P("auth form carries redirectTo for signup too (not gated by isLogin)") : F("signup form drops redirectTo");
/redirectTo[\s\S]{0,200}startsWith\("\/"\)[\s\S]{0,60}"\/onboarding"/.test(authActions)
  ? P("signup honors explicit internal redirectTo, else /onboarding") : F("signup redirect logic");

section("12. Returning login still reaches Dashboard");
/signInWithPassword[\s\S]{0,200}safeRedirectPath/.test(authActions) ? P("login redirects via safeRedirectPath (default /dashboard)") : F("login redirect changed");

section("13. Onboarding cookie is NOT used for authorization");
{
  const authDirs = ["lib/organizations", "lib/auth", "lib/supabase", "lib/drivers"];
  let leak = false;
  const walk = (d) => {
    for (const e of readdirSync(resolvePath(REPO, d))) {
      const p = join(d, e);
      const full = resolvePath(REPO, p);
      if (statSync(full).isDirectory()) walk(p);
      else if (/\.(ts|tsx)$/.test(e) && /vinid_onboarded|ONBOARDED_COOKIE/.test(readFileSync(full, "utf8"))) { leak = true; console.error("    leak:", p); }
    }
  };
  authDirs.forEach((d) => { try { walk(d); } catch {} });
  !leak ? P("no authorization/RLS/session code references the onboarding cookie") : F("onboarding cookie referenced in auth code");
  // Cookie is server-set with SameSite.
  /sameSite:\s*"lax"/.test(onbActions) ? P("cookie is server-set, SameSite=Lax") : F("cookie SameSite");
  onbPage.includes("ONBOARDED_COOKIE") && onbPage.includes("getUser") ? P("page gates on real auth (getUser) separately from the cookie") : F("page auth gate");
}

section("14. Hebrew / English parity for onboarding");
{
  const keys = (o) => { const s = new Set(); (function w(x, p) { for (const k in x) { const np = p ? p + "." + k : k; const v = x[k]; v && typeof v === "object" && !Array.isArray(v) ? w(v, np) : s.add(np); } })(o, ""); return s; };
  const en = keys(JSON.parse(read("messages/en.json")).onboarding);
  const he = keys(JSON.parse(read("messages/he.json")).onboarding);
  en.size === he.size && [...en].every((k) => he.has(k)) ? P(`onboarding en/he parity (${en.size} keys)`) : F("onboarding parity mismatch");
}

section("15. RTL-safe layout (logical props, no physical directional classes)");
!/\b(text-left|text-right|\bml-\d|\bmr-\d|\bpl-\d|\bpr-\d|left-\d|right-\d)\b/.test(flow)
  ? P("no physical left/right classes in the onboarding flow") : F("physical directional class present");
/text-start|rtl:|ms-|me-|ps-|pe-/.test(flow) ? P("uses logical/RTL-aware classes") : F("no logical classes");

section("16. Dashboard checklist stays a separate count-derived tracker");
checklist.includes("counts.vehicles") && checklist.includes("OnboardingChecklist") ? P("checklist is count-derived and intact") : F("checklist changed");
!/How will you use|Personal.*Business|choose.*account/i.test(checklist) ? P("checklist does not ask Personal vs Business") : F("checklist duplicates mode choice");

console.log(`\n${fails === 0 ? "OK" : "FAILED"} — ${passes} passed, ${fails} failed`);
process.exit(fails === 0 ? 0 : 1);

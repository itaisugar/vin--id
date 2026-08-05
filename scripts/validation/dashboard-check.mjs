#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-unused-expressions --
   Deliberate `cond ? P(msg) : F(msg)` assertion style; both branches log+tally. */
/**
 * Vehicle-centric dashboard — regression (OFFLINE, structural).
 *
 * Proves the approved redesign: header + write CTAs, ONE compact attention
 * banner (quiet all-clear when nothing is wrong), and a vehicle grid as the
 * dominant content — capped at 4, urgency-first, each card a fixed status arc
 * (colour-only semantics, always with text) linking to the vehicle. The old
 * KPI tiles / insights / deadlines / full action list are no longer rendered
 * on the dashboard. Palette unchanged (existing tokens only), RTL-safe.
 *
 * No browser/device automation — a real-device visual pass is still required.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve as resolvePath } from "node:path";

let fails = 0,
  passes = 0;
const P = (m) => {
  passes++;
  console.log(`  PASS  ${m}`);
};
const F = (m) => {
  fails++;
  console.error(`  FAIL  ${m}`);
};
const section = (t) => console.log(`\n— ${t} —`);
const REPO = resolvePath(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (p) => readFileSync(resolvePath(REPO, p), "utf8");

const page = read("app/(app)/dashboard/page.tsx");
const banner = read("components/fleet/attention-banner.tsx");
const card = read("components/fleet/vehicle-arc-card.tsx");
const service = read("lib/fleet/service.ts");
const globals = read("app/globals.css");

section("1. getFleetOverview exposes precomputed rows (additive, no new query)");
/rows:\s*FleetVehicleRow\[\];/.test(service)
  ? P("FleetOverview declares rows: FleetVehicleRow[]")
  : F("FleetOverview missing rows field");
/\n\s*rows,\n/.test(service)
  ? P("getFleetOverview returns the already-built rows")
  : F("getFleetOverview does not return rows");
!/rows\s*=\s*await/.test(service)
  ? P("no new query added to expose rows (single status source)")
  : F("rows appear to trigger a new query");

section("2. Dashboard IA: header + CTAs, banner, vehicles grid only");
page.includes("<AttentionBanner") ? P("renders the attention banner") : F("no attention banner");
page.includes("<VehicleArcCard") ? P("renders vehicle arc cards") : F("no vehicle cards");
["FleetSummaryCards", "FleetInsights", "DeadlineList", "ActionList"].forEach((c) =>
  !page.includes(`<${c}`)
    ? P(`${c} no longer rendered on the dashboard`)
    : F(`${c} still rendered on the dashboard`));

section("3. Write CTAs are writer-gated and point at existing routes");
/summary\.totalVehicles > 0 && canWrite/.test(page)
  ? P("CTAs shown only to writers with a non-empty fleet")
  : F("CTA gating changed");
page.includes('href="/fleet-intake"') ? P("Scan CTA → /fleet-intake") : F("scan CTA route");
page.includes('href="/vehicles/new"') ? P("Add-vehicle CTA → /vehicles/new") : F("add-vehicle CTA route");

section("4. Personal vs business title");
/isPersonalWorkspace/.test(page) &&
/titlePersonal/.test(page) &&
/titleBusiness/.test(page)
  ? P('"Your vehicles" (personal) vs "Your fleet" (business)')
  : F("workspace-aware title missing");
!/Good morning|getHours\(\)/.test(page)
  ? P("no time-based greeting logic")
  : F("time-based greeting was added");

section("5. Vehicle preview: capped at 4, urgency-first, view-all");
/slice\(0, 4\)/.test(page) ? P("preview capped at 4") : F("preview not capped at 4");
/rowUrgencyKey/.test(page) ? P("urgency-first ordering") : F("not urgency-first");
page.includes('href="/vehicles"') ? P("View all → /vehicles") : F("no view-all link");
/summary\.totalVehicles/.test(page) && /dashboard-vehicles-heading/.test(page)
  ? P("section heading shows the total count")
  : F("count missing from heading");
!/carousel|overflow-x|pagination/i.test(page)
  ? P("no pagination / carousel / horizontal scroll")
  : F("pagination or horizontal scroll present");

section("6. Attention banner: one compact surface, quiet all-clear, +N");
(banner.match(/<Link/g) || []).length === 1
  ? P("exactly one banner link (not a wall of alert cards)")
  : F("more than one alert surface");
banner.includes('href="/vehicles?filter=needs_attention"')
  ? P("Review → existing needs-attention list")
  : F("review destination changed");
/allClear/.test(banner) && /affected\.length === 0/.test(banner)
  ? P("quiet all-clear branch when nothing needs attention")
  : F("all-clear branch missing");
/MAX_PLATES/.test(banner) && /more/.test(banner)
  ? P("affected plates capped with +N overflow")
  : F("plate overflow handling missing");
/border-danger|border-warn/.test(banner) && !/bg-ok\/\d/.test(banner)
  ? P("uses only warning/danger tokens (no large success panel)")
  : F("non-approved tone tokens in banner");

section("7. Vehicle card: meaningful health ring, colour + text, single link");
/let score = 100/.test(card) &&
/score -= PENALTY\[a\.urgency\]/.test(card) &&
/Math\.max\(0, Math\.min\(100/.test(card)
  ? P("healthScore: starts at 100, subtracts real penalties, clamps 0–100")
  : F("health score model missing or not clamped");
/strokeDashoffset=\{offset\}/.test(card) && /CIRC \* \(1 - score \/ 100\)/.test(card)
  ? P("ring fill is the health score (full circle at 100)")
  : F("ring fill not driven by the score");
/score >= 85/.test(card) && /score >= 45/.test(card)
  ? P("colour steps green→orange→red by score thresholds (85 / 45)")
  : F("colour thresholds missing");
/stroke-danger/.test(card) && /stroke-warn/.test(card) && /stroke-ok/.test(card)
  ? P("ring colour uses danger/warn/ok tokens")
  : F("ring colour states incomplete");
/\{make\}/.test(card) && /line-clamp-2/.test(card) && /break-words/.test(card)
  ? P("make centred in the ring; long names wrap/clamp (no overflow)")
  : F("make label or overflow handling missing");
/actions\.reasons\.\$\{/.test(card) && /td\("ready"\)/.test(card)
  ? P("status line reuses existing reasons wording; ready = Ready")
  : F("status line wording invented or missing");
/license_plate[\s\S]{0,120}text-2xl/.test(card)
  ? P("plate remains the dominant text outside the ring")
  : F("plate not dominant");
(card.match(/<Link/g) || []).length === 1
  ? P("whole card is one link (no nested conflicting links)")
  : F("card has zero or multiple links");
!/<img|photo_url|telltale/i.test(card)
  ? P("no images, photos, or telltale rows in the card")
  : F("disallowed card content present");

section("8. Empty workspace preserved");
/summary\.totalVehicles === 0 \? \(\s*<EmptyFleet/.test(page)
  ? P("EmptyFleet shown for zero vehicles (no banner/grid)")
  : F("empty-fleet handling changed");

section("9. Palette unchanged — no hardcoded colors, accent token intact");
const HEX = /#[0-9a-fA-F]{3,8}\b/;
const RGBHSL = /\b(rgb|rgba|hsl|hsla)\(/;
[
  ["dashboard/page.tsx", page],
  ["attention-banner.tsx", banner],
  ["vehicle-arc-card.tsx", card],
].forEach(([name, src]) =>
  !HEX.test(src) && !RGBHSL.test(src)
    ? P(`no hardcoded color in ${name}`)
    : F(`hardcoded color introduced in ${name}`));
/--accent:\s*#4169e1;/.test(globals)
  ? P("COCKPIT accent token unchanged (#4169e1)")
  : F("accent token changed");

section("10. RTL-safe (logical props, no physical directional classes)");
[
  ["dashboard/page.tsx", page],
  ["attention-banner.tsx", banner],
  ["vehicle-arc-card.tsx", card],
].forEach(([name, src]) =>
  !/\b(text-left|text-right|\bml-\d|\bmr-\d|\bpl-\d|\bpr-\d|left-\d|right-\d)\b/.test(
    src,
  )
    ? P(`no physical left/right classes in ${name}`)
    : F(`physical directional class in ${name}`));

section("11. Hebrew / English parity for the new dashboard copy");
{
  const en = JSON.parse(read("messages/en.json")).dashboard;
  const he = JSON.parse(read("messages/he.json")).dashboard;
  const need = [
    ["titlePersonal", en.titlePersonal, he.titlePersonal],
    ["titleBusiness", en.titleBusiness, he.titleBusiness],
    ["attention.title", en.attention?.title, he.attention?.title],
    ["attention.review", en.attention?.review, he.attention?.review],
    ["attention.allClear", en.attention?.allClear, he.attention?.allClear],
    ["attention.more", en.attention?.more, he.attention?.more],
    ["vehicles.heading", en.vehicles?.heading, he.vehicles?.heading],
    ["vehicles.viewAll", en.vehicles?.viewAll, he.vehicles?.viewAll],
    ["vehicles.ready", en.vehicles?.ready, he.vehicles?.ready],
  ];
  need.every(([, e, h]) => e && h)
    ? P("all new dashboard keys present in en and he")
    : F("a new dashboard key is missing in a locale");
}

console.log(`\n${fails === 0 ? "OK" : "FAILED"} — ${passes} passed, ${fails} failed`);
process.exit(fails === 0 ? 0 : 1);

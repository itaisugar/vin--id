# Dashboard (vehicle-centric)

Branch `feat/dashboard-vehicle-centric-redesign` (from `origin/main` @ `fdf02ff`).
**Presentation-only — no migration, no dependency, no palette change, no
`app/globals.css` edit, no RLS/role/Driver change.** Matches the approved visual
reference: simple, premium, calm, vehicle-first.

## Information architecture
1. App shell (unchanged) — brand, language switch, logout, navigation.
2. Dashboard header — greeting, a context-aware title
   (**"Your vehicles"** for a personal workspace, **"Your fleet"** for business),
   and two writer-only CTAs: **Scan a document** (primary → `/fleet-intake`) and
   **Add vehicle** (secondary → `/vehicles/new`).
3. One **attention surface** — a single compact banner when any vehicle needs
   attention; a small quiet all-clear line otherwise.
4. **Vehicles** — the dominant content: heading + total count + View all, then a
   grid of large arc cards.
5. Nothing else in the primary dashboard.

Removed from the dashboard (components kept for their other callers, just no
longer rendered here): `FleetSummaryCards`, `FleetInsights`, `DeadlineList`, the
full `ActionList`.

## Attention banner
Shown only when ≥1 vehicle has an action (the existing needs-attention rule).
Compact, full-width: alert chip, "Needs your attention", affected plates capped
to 3 with a `+N` overflow, and one **Review** link to
`/vehicles?filter=needs_attention`. Tone is danger when any affected vehicle is
critical/urgent, otherwise warning — existing tokens only. When nothing needs
attention it collapses to a small "All clear" line with a tiny ok dot; it never
occupies an active warning's height and shows no zero values.

## Vehicle card
The main interaction surface. Whole card is one link to `/vehicles/[id]`.
- **Left status arc** — a motif, not a gauge: fixed 270° geometry on every card
  (a faint full-circle track plus a coloured 270° arc). Only the colour carries
  meaning — danger / warn / ok — so it never encodes a percentage, score,
  progress or remaining time. Status is always also in text.
- Large plate (or display title), a small status dot, make/model/year, and one
  concise status line: the highest-priority real action's existing translated
  reason wording, or **"Ready"** when the vehicle is healthy. No invented "MOT"
  term, no new alert types, no images, no telltale rows, no per-card quick
  actions.
- Interaction: existing-token hover surface change, `cockpit-lift`, press
  (`active:scale`), visible focus ring, adequate touch target.

## Data
`getFleetOverview()` keeps its five org-scoped queries and additively returns
`rows: FleetVehicleRow[]` — the per-vehicle rows it **already computes in
memory**. This gives the dashboard the same effective vehicle state the fleet
list uses (no second calculation) and avoids the global 15-action cap on
`actions` marking a capped-out vehicle "Ready". No new query, no migration.

Preview = rows sorted urgency-first (worst action first, then more actions, then
plate), sliced to **4**. 4-or-fewer fleets show all; larger fleets show the first
4 and keep View all.

## Responsive / RTL
Desktop: greeting/title and CTAs share the header row; banner full-width;
2-column vehicle grid (four cards → two balanced rows via `h-full`). Mobile:
title first, CTAs wrap, banner stacks without overflow, one-column grid, arc
stays large, plate/status never compressed, no horizontal page scroll (`min-w-0`
in the shell). Logical RTL-safe utilities throughout; the Review arrow flips;
plate numbers stay LTR/tabular (`num`).

## Empty workspace
Zero vehicles → the existing `EmptyFleet` (no attention banner, no grid).

## Tests
`validate:dashboard` — 30 offline structural assertions: additive rows exposure,
IA (banner + cards; tiles/insights/deadlines/full action list removed),
writer-gated CTAs, workspace-aware title with no time greeting, capped
urgency-first preview with view-all and count, one compact banner + quiet
all-clear + `+N`, fixed arc geometry with colour-only semantics and text,
single-link card with no images/telltales, empty-fleet preserved, no hardcoded
colours + accent token intact, RTL-safe, en/he parity.

## Files
`app/(app)/dashboard/page.tsx`, `components/fleet/attention-banner.tsx` (new),
`components/fleet/vehicle-arc-card.tsx` (new), `lib/fleet/service.ts`,
`messages/{en,he}.json`, `scripts/validation/dashboard-check.mjs` (new),
`package.json`.

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
- **Left health ring** — a real indicator, not decoration. Its fill is a
  deterministic 0–100 health score (100 = healthy → full circle); its colour
  steps green → orange → red as attention rises. The **make** name sits centred
  inside the ring (long names wrap to two small lines and clamp — never
  overflow; a car glyph shows when the make is unknown).
- **Health score** — start from 100 and subtract per active action, by the
  existing urgency level (`critical 72`, `high 58`, `soon 22`, `info 16`), plus a
  small capped bonus penalty (`min((count-1)*5, 15)`) when one action covers
  several records. Clamped to `[0, 100]`. Uses only the vehicle's real actions —
  the same alert rules the fleet list uses; no second calculation, no new data.
  - Real signals (by urgency): critical = overdue service / expired document /
    unavailable; high = urgent open issue; soon = due-soon service / expiring
    document / open issue; info = missing service data / cost anomaly.
  - Colour bands: `score ≥ 85` green (reachable only with no active attention),
    `45–84` orange, `< 45` red. Any single action ≥ 16 pts, so an attended
    vehicle is never green; a critical/high or several items lands it red — which
    is why "multiple attention" reads red exactly as intended.
  - `arcState(row)` returns this band and is reused by the attention banner, so
    banner tone and card ring are always consistent.
- Plate stays the dominant text outside the ring; a small status dot; model ·
  year; one concise status line — the highest-priority real action's existing
  translated reason wording, or **"Ready"** when healthy. No invented "MOT"
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
`validate:dashboard` — 42 offline structural assertions: additive rows exposure,
IA (banner + cards; tiles/insights/deadlines/full action list removed),
writer-gated CTAs, workspace-aware title with no time greeting, capped
urgency-first preview with view-all and count, one compact banner + quiet
all-clear + `+N`, the health-score model (starts at 100, subtracts, clamps),
ring fill driven by the score with green/orange/red thresholds, make centred
with overflow handling, dominant plate, single-link card with no images/
telltales, status text preserved, empty-fleet preserved, no hardcoded colours +
accent token intact, RTL-safe, en/he parity.

## Files
`app/(app)/dashboard/page.tsx`, `components/fleet/attention-banner.tsx` (new),
`components/fleet/vehicle-arc-card.tsx` (new), `lib/fleet/service.ts`,
`messages/{en,he}.json`, `scripts/validation/dashboard-check.mjs` (new),
`package.json`.

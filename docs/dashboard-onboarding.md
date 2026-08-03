# Dashboard Onboarding (Private-first)

Branch `feat/dashboard-onboarding`. Not merged / not deployed. No database change.

## Original implementation (superseded)
The first pass added a 3-way "How will you use VIN-ID?" mode selection —
Personal / Join organization / Create organization — with an embedded
create-organization form and a pasted invitation-link/token input inside
onboarding.

## Corrected product decision — Private-first
VIN-ID is Private-first. A new user already has their Personal workspace, so
onboarding must **not** ask the user to pick an account type. It welcomes them,
communicates the value, and guides them to add their first vehicle. Business
organization creation stays an intentional action in **Team & Access**; joining
stays **invitation-link** driven. Onboarding no longer creates or implies any
permanent account type.

## Final flow (two steps)
1. **Welcome** — COCKPIT instrument-cluster hero (rev-counter ring, ambient
   glow), short value proposition, one primary CTA. Copy:
   - EN: "Your vehicle. Every record. One place." / "Keep documents,
     maintenance, reminders and history in one Vehicle Passport." / "Get started"
   - HE: "הרכב שלך. כל המידע. מקום אחד." / "שמור מסמכים, טיפולים, תזכורות
     והיסטוריה ב־Vehicle Passport אחד." / "בואו נתחיל"
2. **Add first vehicle** — "How would you like to add your first vehicle?" with
   exactly three choices deep-linking into the existing Add Vehicle flow:
   - Registration number lookup → `/vehicles/new?method=lookup`
   - Scan vehicle registration → `/vehicles/new?method=scan`
   - Manual entry → `/vehicles/new?method=manual`
   Secondary action "I'll add a vehicle later" completes onboarding → `/dashboard`.
   No separate Success screen.

A minimal two-notch gauge stepper + digital `01/02` readout shows progress; a
header Skip is always available; the vehicle step has a Back to Welcome.

## Invitation behavior (preserved + fixed)
Sign-up now routes to `/onboarding`, but an explicit internal `redirectTo` is
honored first, so an invitation link that sends a recipient to sign up lands on
`/invite/[token]` rather than being detoured. A latent bug was fixed: the
sign-up **credentials** form only emitted the `redirectTo` hidden field for
login (`isLogin && redirectTo`); it now emits it for sign-up too. Sign-up still
creates the Personal workspace; invitation acceptance adds the Business
membership with the inviter-selected role; Personal remains available. No
generic invitation-code entry system was added; onboarding parses no tokens.

## Business organization behavior (unchanged)
Creating a Business organization remains only in **Team & Access → Create
organization**, via the already-validated `create_business_organization` RPC.
The Personal-invitation restriction, role matrix, workspace switching and
membership behavior are untouched. RLS unchanged.

## Dashboard checklist distinction
`components/dashboard/onboarding-checklist.tsx` remains a **count-derived Setup
Progress** tracker (vehicle → maintenance → document → passport → preview →
install). It is not a second onboarding journey and never asks Personal vs
Business. Only a minimal copy change was made: its title "Get started" (which
now duplicated the onboarding CTA) became "Setup progress" / "התקדמות ההגדרה".

## Completion persistence (cookie)
Completion is a server-set cookie `vinid_onboarded` (SameSite=Lax), set by the
`completeOnboarding()` server action when the user picks a vehicle method or
skips. Properties:
- Never used for authorization, account type, or organization permissions — the
  onboarding page still gates on real auth (`getUser`) independently.
- Only fresh sign-ups are routed to `/onboarding`; returning users log in
  straight to `/dashboard`, so onboarding is never re-forced.
- **Limitation:** it is per-device. A future upgrade could store
  `profiles.onboarding_completed_at` for cross-device state/analytics — **not
  added here** (no migration in this correction).

## Tests
`validate:onboarding` — 27 offline structural assertions: Welcome first; CTA →
vehicle step; exactly three method deep links (lookup/scan/manual); skip/later →
Dashboard; no mode screen; no CreateOrganizationForm; no invitation/token input;
messages drop mode/join/create; sign-up carries `redirectTo` (not gated by
isLogin) and honors it else `/onboarding`; login still uses `safeRedirectPath`;
the cookie is absent from all authorization/RLS/session code and is SameSite=Lax;
en/he parity; RTL-safe (logical classes only, two-notch gauge, no fake segments);
checklist stays count-derived. Full regression stays green (incl. private-first).

## Visual QA checklist (manual — founder)
- **Hebrew mobile:** Welcome, gauge/progress, CTA, three method cards, RTL, no
  overflow, Back, Skip, deep link to each vehicle method.
- **English desktop:** Welcome, method selection, typography/spacing, LTR,
  keyboard focus, reduced motion.

## Files
`app/onboarding/{page,actions}.ts(x)`, `lib/onboarding.ts`,
`components/onboarding/onboarding-flow.tsx`, `app/(auth)/{actions.ts,auth-form.tsx}`,
`components/vehicles/add-vehicle-flow.tsx`, `app/(app)/vehicles/new/page.tsx`,
`components/dashboard/onboarding-checklist.tsx` (title only), `messages/{en,he}.json`,
`scripts/validation/onboarding-check.mjs`.

# Vin.ID — Beta Readiness

Status and guidance for running a small, free beta with real users. The app is
free-tier (Vercel Hobby + Supabase Free) and uses **mock** AI — no paid
services, no AI keys.

## What is ready for beta
- **Auth** — email/password signup, login, logout, protected routes.
- **Vehicles** — create / view / edit / archive.
- **Maintenance, Issues, Reminders** — full CRUD, soft delete, mileage tracking,
  urgency, resolve.
- **Documents** — upload to a **private** bucket; view via short-lived signed
  URLs; metadata editing.
- **Vehicle Passport** — create a frozen snapshot (SHA-256 hash), share link,
  public preview at `/p/[token]`, revoke.
- **Ownership transfer** — buyer accepts a Passport → copied vehicle + history;
  seller vehicle marked sold; recorded transfer.
- **Mock diagnosis** — symptom → cautious guidance; save as issue.
- **Mock document extraction** — review-then-confirm; never auto-applies.
- **i18n** — English + Hebrew, RTL.
- **Beta basics** — beta label, onboarding, in-app feedback, Privacy/Terms,
  friendly 404/error pages.
- **Privacy-safe event tracking** — minimal first-party product events in
  Supabase `app_events` (no third-party analytics). See
  `docs/event-tracking.md`.

## What is still mock (must be communicated to testers)
- **AI diagnosis** is a deterministic keyword-based mock — **not** real AI.
- **Document extraction** is a deterministic mock — **not** real OCR/AI. It only
  infers from the document type / file name.
- Both show a "mock mode" notice. `MOCK_AI=true` in all environments.

## What must NOT be promised to users
- It is **not** an official ownership / title / registration system.
- A Vehicle Passport is **not** a mechanical certification or condition guarantee.
- Diagnosis is informational only and **does not replace a qualified mechanic**.
- "Record Confidence" measures **documentation quality**, not vehicle condition.
- Do not present mock AI as real AI.

## Known limitations
- Document **files are not copied** to the buyer on accept (metadata only).
- No PDF export, QR codes, real AI/OCR, blockchain, payments, or marketplace.
- Signed URLs expire after a few minutes (re-open to refresh).
- Data deletion/export is manual for now (self-service is a future TODO).
- Beta feedback is stored in Supabase (`beta_feedback`); reviewed in the console
  (no email/notifications).
- Single-shot diagnosis (no multi-turn chat).

## Suggested beta tester tasks
1. Sign up, switch language EN↔HE, confirm layout flips (RTL).
2. Add a vehicle; add a maintenance record and an issue; add a reminder.
3. Upload a document (PDF or image); open it; try "Extract with AI" → review →
   confirm or discard.
4. Run a diagnosis with a clear symptom (e.g. "squeaking when braking"); save it
   as an issue.
5. Create a Vehicle Passport; copy the share link; open it in a private window
   (logged out) and confirm it looks right.
6. With a **second account**, accept the Passport; confirm the vehicle + history
   appear in the buyer's account.
7. Revoke a Passport and confirm the public link stops working.
8. Send feedback from **Settings → Send beta feedback**.

## Free-tier constraints
- Supabase Free: storage/row/egress limits — fine for a small beta.
- Vercel Hobby: standard limits; no cron/long-running jobs used.
- No external paid dependencies.

## Safety / legal caveats
- `/privacy` and `/terms` are **beta-stage summaries**, clearly marked, with
  `TODO(legal)` notes — **must be reviewed by a legal professional before any
  public (non-beta) launch.**
- Diagnosis copy is intentionally cautious; the mock never says "safe to drive:
  yes" and surfaces stop/urgent warnings.
- Tell testers explicitly: do not rely on Vin.ID for safety-critical decisions.

## Security reminders (unchanged from production notes)
- No service-role key in the app; privileged ops use `SECURITY DEFINER` RPCs.
- Public preview exposes snapshot data only — no `storage_path`, no
  `owner_user_id`/`issuer_user_id`, no `token_hash`.
- Storage bucket private; RLS enabled on every table; no public table policies.
- Event tracking stores only non-sensitive metadata (counts/booleans/enums);
  `app_events` is insert-only under RLS (no read), and the anonymous preview
  event is written by a `SECURITY DEFINER` function that never stores the raw
  token or its hash.

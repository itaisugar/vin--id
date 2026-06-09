# Vin.ID — Final Beta Checklist (before inviting testers)

Run this once, right before sending invitations. ~15–20 minutes. If anything
fails, fix it (or note it in the invite) before inviting testers. Companion
docs: [deployment-notes.md](deployment-notes.md),
[production-qa-checklist.md](production-qa-checklist.md),
[data-safety-review.md](data-safety-review.md),
[mobile-ux-checklist.md](mobile-ux-checklist.md).

## Deployment & config
- [ ] Production deploy is **live** and the latest Vercel build is **Ready**.
- [ ] `GET /api/health` returns `{ "ok": true, "app": "Vin.ID" }`.
- [ ] Env vars set: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
      `MOCK_AI=true`, `APP_PUBLIC_URL`.
- [ ] **`APP_PUBLIC_URL`** is the real production URL (share links use it).
- [ ] **Supabase Auth** Site URL + Redirect URLs include the production domain
      (and localhost for dev). Signup confirmation links resolve.
- [ ] All migrations applied (Supabase SQL Editor), through
      `20260608060000_beta_feedback_more_types.sql`.

## Security & data
- [ ] Storage bucket `vehicle-documents` is **private**.
- [ ] **RLS enabled** on every table; no public/anon SELECT policies.
- [ ] **No `storage_path`** in the public preview / print / exports.
- [ ] **No `token_hash`** or raw token in UI, exports, or events.
- [ ] Privacy audit query returns **0 rows**
      (`supabase/audits/app_events_privacy_audit.sql`).

## Core flows (do a real run in production)
- [ ] **Signup / login / logout** work.
- [ ] **Vehicle Passport**: create → copy share link → open public preview in a
      private window → **accept** as a second account → seller vehicle is "sold".
- [ ] **Mock diagnosis** works (shows mock notice) and "save as issue" works.
- [ ] **Mock document extraction**: extract → review → confirm/discard.
- [ ] **Feedback** submits (check a row appears in `beta_feedback`).
- [ ] **Data export**: JSON + maintenance CSV + issues CSV download.

## UX
- [ ] **Mobile** check complete (no horizontal scroll; nav clears submit buttons).
- [ ] **Hebrew/English** check complete (RTL flips; no untranslated keys).
- [ ] Landing page (`/`) renders for signed-out visitors; CTAs go to
      signup/login; Privacy/Terms link works.
- [ ] Version shows **v0.1 beta** in Settings.

## Beta pack
- [ ] [beta-release-notes-v0.1.md](beta-release-notes-v0.1.md) reviewed.
- [ ] [beta-tester-guide.md](beta-tester-guide.md),
      [beta-test-script.md](beta-test-script.md),
      [beta-feedback-prompts.md](beta-feedback-prompts.md),
      [known-limitations.md](known-limitations.md) ready to send.
- [ ] [beta-invitation-message.md](beta-invitation-message.md) personalized.
- [ ] You can read feedback in Supabase (`beta_feedback`) and events in
      `app_events` / the insight views.

When every box is ticked, send the invitations. 🚗

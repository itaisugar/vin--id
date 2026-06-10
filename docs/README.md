# Vin.ID — Documentation Index

Operational, safety, and beta docs for Vin.ID (Next.js + Supabase, free-tier,
mock AI). Start here. Current release: **v0.1-beta**.

## Launch (v0.1-beta)
- [beta-release-notes-v0.1.md](beta-release-notes-v0.1.md) — what's in the
  release, what's mock, what's not included, what testers should focus on.
- [final-beta-checklist.md](final-beta-checklist.md) — run before inviting
  testers.
- [beta-invitation-message.md](beta-invitation-message.md) — tester invite
  (English + Hebrew).
- [free-beta-freeze-policy.md](free-beta-freeze-policy.md) — scope freeze rules.

## Beta tester pack
- [beta-tester-guide.md](beta-tester-guide.md) — what Vin.ID is, what to test,
  what's mock, privacy + safety, how to give feedback (send this to testers).
- [beta-test-script.md](beta-test-script.md) — step-by-step test tasks (A–G).
- [beta-feedback-prompts.md](beta-feedback-prompts.md) — questions for testers.
- [known-limitations.md](known-limitations.md) — what's intentionally not built
  yet.

## Beta readiness & sharing
- [beta-readiness.md](beta-readiness.md) — what's ready, what's mock, caveats.
- [beta-share-flow.md](beta-share-flow.md) — how Passport sharing works today.
- [pdf-export-notes.md](pdf-export-notes.md) — print/PDF export behavior.

## Access & install
- [google-oauth-setup.md](google-oauth-setup.md) — enable "Continue with Google"
  (Google Cloud + Supabase; no secrets in code).
- [pwa-install-notes.md](pwa-install-notes.md) — Add to Home Screen / standalone
  PWA, icons, how to test.

## Deployment & QA
- [deployment-notes.md](deployment-notes.md) — Vercel + Supabase deploy steps,
  env vars, auth redirect URLs.
- [production-qa-checklist.md](production-qa-checklist.md) — pre-deploy QA.
- [production-health-checklist.md](production-health-checklist.md) — weekly
  health checks.
- [production-bug-report-template.md](production-bug-report-template.md).
- [mvp-qa-checklist.md](mvp-qa-checklist.md),
  [passport-qa-checklist.md](passport-qa-checklist.md) — feature QA.
- [mobile-ux-checklist.md](mobile-ux-checklist.md) — mobile/RTL manual checks.

## Data safety, privacy & backups
- [data-safety-review.md](data-safety-review.md) — RLS, soft delete, snapshot
  immutability, leakage review.
- [snapshot-integrity-test.md](snapshot-integrity-test.md) — manual snapshot
  immutability test.
- [data-export-and-account-control.md](data-export-and-account-control.md) —
  JSON/CSV export + request-based deletion.
- [manual-backup-checklist.md](manual-backup-checklist.md) — manual backups.

## Analytics & health (first-party only)
- [event-tracking.md](event-tracking.md) — privacy-safe `app_events`.
- [beta-insights.md](beta-insights.md) — aggregate views + privacy audit queries.

## Applying database migrations
Migrations live in [`../supabase/migrations/`](../supabase/migrations/). Run any
not-yet-applied file in the **Supabase SQL Editor** (in filename order). The
later beta phases added:
- `..._app_events.sql` — product event log (6E).
- `..._beta_insight_views.sql` — aggregate insight views (6F).
- `..._beta_feedback_deletion_request.sql` — deletion-request feedback (6G).
- `..._beta_feedback_more_types.sql` — trust/privacy + beta-test-result feedback
  types (6J).

Manual audit queries (not migrations) live in
[`../supabase/audits/`](../supabase/audits/).

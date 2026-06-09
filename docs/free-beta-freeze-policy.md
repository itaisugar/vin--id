# Vin.ID — Free Beta Freeze Policy

The scope for **v0.1-beta** is **frozen**. This policy keeps the closed beta
focused on learning from real testers before adding cost or complexity.

## The rule

**No new product features before tester feedback.** Ship the beta as-is, watch
how 5–10 real users behave, then decide what's next from evidence — not guesses.

## What is allowed during the freeze

- **Bug fixes** — anything broken or incorrect.
- **Safety fixes** — data leaks, RLS/privacy issues, snapshot-integrity issues.
- **Copy fixes** — clarity, accuracy, translations, removing overclaiming.
- **UX blockers** — issues that stop a tester from completing the core flow
  (e.g. a broken button, an unreadable mobile layout, a confusing dead end).

## What is NOT allowed during the freeze

- New product features or new screens.
- Refactors of core logic (Passport token/security/accept, ownership transfer,
  snapshot generation) unless fixing a clear safety/bug issue.
- **Paid services or external SaaS** of any kind.
- Turning on **real AI / real OCR** — and **never** claim them while `MOCK_AI`
  is active. The app/landing must keep saying "mock/demo" until real providers
  ship behind a deliberate decision.

## Deciding what comes after beta

- **Track feedback first.** Use `beta_feedback` and the `app_events` insight
  views (funnel, acceptance rate) to see what testers actually do and say.
- **Don't add paid AI/OCR until evidence supports it.** Only invest in real
  AI/OCR (or any paid dependency) once tester feedback shows it's the blocker to
  trust/usefulness — and there's a plan to keep a free path working.
- Re-evaluate the [known-limitations.md](known-limitations.md) list against what
  testers ask for, and prioritize from there.

## Exit criteria (lifting the freeze)

Lift the freeze deliberately, after:
1. The beta cohort has run the [beta-test-script.md](beta-test-script.md).
2. Feedback is collected and themed.
3. A short, written decision on the next scope (what to build, what to keep
   mock, whether any paid dependency is justified).

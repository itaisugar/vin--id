# Vin.ID — Beta Release Notes (v0.1-beta)

The first closed beta of Vin.ID — a smart digital vehicle identity app, built on
the free tier (Vercel + Supabase) with **mock** AI. For a small group of 5–10
testers. Plan ~20–30 minutes to run through it.

## What's included in v0.1-beta

- **Auth** — email/password sign up, login, logout, protected routes.
- **Vehicles** — create / view / edit / archive (sold/archived, never deleted).
- **Maintenance logs** — full CRUD, soft delete, mileage tracking, trust labels.
- **Issue logs** — symptoms, severity, status, resolve, soft delete.
- **Documents + private storage** — upload to a private bucket; view via
  short-lived signed URLs; metadata editing; share flags.
- **Reminders** — by date and/or mileage; urgency; dashboard roll-up.
- **Vehicle Passport** — frozen, tamper-evident snapshot (SHA-256 hash) of
  selected history with a Record Confidence Score.
- **Public Passport preview** — `/p/[token]`, read-only, snapshot data only.
- **Accept Passport / ownership transfer** — buyer copies the shared history into
  their account; seller vehicle becomes "sold".
- **Print / Save as PDF** — browser print of the Passport snapshot.
- **Mock diagnosis** — cautious, deterministic troubleshooting guidance.
- **Mock document extraction** — review-then-confirm metadata suggestions.
- **Feedback** — in-app beta feedback (Settings).
- **Data export** — JSON + maintenance/issues CSV (Settings → Data & privacy).
- **Privacy / Terms** — beta-stage summaries.
- **Public landing page** — at `/` for signed-out visitors.
- **Languages** — English + Hebrew (RTL).

## What is intentionally mock

- **AI diagnosis** — deterministic, keyword-based; **not** real AI. Shows a
  "mock mode" notice.
- **Document extraction** — infers from type/file name; **not** real OCR/AI.
  Always requires confirmation.

(Both run with `MOCK_AI` on. The landing/app only claim "mock/demo" while it is.)

## What is intentionally NOT included

- Real AI, real OCR.
- Mechanic verification.
- OBD / hardware integration.
- Payments / subscriptions.
- Marketplace.
- Blockchain anchoring.
- Automated account deletion (request-based only).
- Automatic document redaction.
- Document **file** copy during ownership transfer (metadata only today).

See [known-limitations.md](known-limitations.md) for the full list.

## What testers should focus on

1. **Can they understand the Vehicle Passport?** Could they explain it?
2. **Do they trust it?** What builds or breaks trust?
3. **Would they share it with a buyer?**
4. **Is mobile usable?** Any cramped/cut-off/awkward spots (incl. Hebrew RTL).
5. **Are the privacy warnings clear?** (sharing flags, "not official", exports.)

## Safety

Vin.ID is beta software. A Vehicle Passport is **not** an official ownership
document or a mechanical certification, and "Record Confidence" reflects
documentation quality, not vehicle condition. Don't rely on Vin.ID for
safety-critical decisions — always inspect a vehicle and consult a professional.

## How to give feedback

In the app: **Settings → Send beta feedback** (types include Bug, Idea,
Confusing, Trust / privacy concern, Beta test result, Other). Guiding questions:
[beta-feedback-prompts.md](beta-feedback-prompts.md).

Version is shown in **Settings** as **v0.1 beta**.

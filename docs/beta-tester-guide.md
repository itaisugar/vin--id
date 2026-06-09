# Vin.ID — Beta Tester Guide

Thanks for testing Vin.ID! This guide tells you what it is, what to try, and
what to expect. Plan for about **20–30 minutes**. Use a **phone** if you can,
and a **desktop** too if possible.

## What Vin.ID is

Vin.ID is a smart digital vehicle identity app. You keep a vehicle's history —
maintenance, issues, documents, reminders — in one place. The headline feature
is the **Vehicle Passport**: a frozen, tamper-evident snapshot of selected
history you can share with a buyer, who can then accept it to copy that history
into their own account.

## What to test

- Creating an account and switching language (English ⇄ עברית).
- Adding a vehicle and building its history (maintenance, issue, document,
  reminder).
- The **mock** AI flows (diagnosis, document extraction).
- Creating a **Vehicle Passport**, viewing the **Record Confidence Score**,
  sharing the link, opening the public preview, and saving a PDF.
- Accepting a Passport as a second user (transfer).
- Sending feedback from **Settings → Send beta feedback**.

Follow the step-by-step **[beta-test-script.md](beta-test-script.md)**.

## What is still mock / demo

- **AI diagnosis** is a deterministic keyword-based **mock** — not real AI. It
  shows a "mock mode" notice.
- **Document extraction** ("Extract with AI") is a **mock** — not real OCR/AI.
  It infers from the document type / file name and always asks you to confirm.
- **PDF export** uses your browser's **Print → Save as PDF** — there is no
  server-generated official PDF.

## What not to rely on yet

- A Vehicle Passport is **not** an official ownership/title document and **not**
  a mechanical certification.
- The Record Confidence Score measures **how well the history is documented** —
  not the vehicle's condition.
- Diagnosis guidance is informational and does **not** replace a qualified
  mechanic.
- Don't use Vin.ID for safety-critical decisions during the beta.

## Safety disclaimers

Always inspect a vehicle and consult a professional before buying or selling.
The mock diagnosis is cautious by design and never tells you a car is definitely
safe to drive.

## Privacy expectations

- Your data is private to your account (per-user security). Documents are stored
  in a **private** bucket and shared only if you explicitly allow it in a
  Passport.
- Public Passport links expose only the **snapshot** you chose to share — never
  your account, raw files, or storage paths.
- You can **export** your data (JSON/CSV) from **Settings → Data & privacy**.
  Exports don't include the original uploaded files. Keep exports private — they
  can contain sensitive info.
- Automated account deletion isn't enabled in beta; you can **request deletion**
  from Settings and we'll handle it manually.
- We log minimal, non-sensitive product events (e.g. "a Passport was created")
  to understand usage — no third-party analytics, no document contents,
  symptoms, VIN, plates, or tokens. See [event-tracking.md](event-tracking.md).

## How to report feedback

Use **Settings → Send beta feedback**. Pick a type:
**Bug**, **Idea**, **Confusing**, **Trust / privacy concern**,
**Beta test result**, or **Other**. Your current page is captured automatically
for context. The **[beta-feedback-prompts.md](beta-feedback-prompts.md)**
questions are a great guide for what to tell us.

## Recommended setup

- **Device**: a phone is ideal (test mobile layout + RTL); add desktop if you
  can.
- **Two accounts / a private window**: needed for the Passport transfer test
  (seller + buyer).

Known limitations are listed in **[known-limitations.md](known-limitations.md)**.
Thank you! 🚗

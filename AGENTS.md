<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->
---

# Vin.ID Project Instructions

Vin.ID is a responsive web app / PWA only.
Do not build React Native or Expo.

Tech stack:
•⁠  ⁠Next.js App Router
•⁠  ⁠TypeScript
•⁠  ⁠Tailwind CSS
•⁠  ⁠shadcn/ui
•⁠  ⁠Supabase Auth, Postgres, Storage, RLS
•⁠  ⁠English/Hebrew localization with RTL support
•⁠  ⁠Free-tier-first architecture

Core product:
Vin.ID is a smart digital vehicle identity app.
It manages vehicles, maintenance records, issue logs, documents, reminders, and AI-assisted diagnosis.
The core differentiator is Vehicle Passport: a trusted, shareable, tamper-evident vehicle history snapshot for buyers and ownership transfer.

Rules:
•⁠  ⁠Do not use paid services as hard requirements.
•⁠  ⁠AI must work in MOCK_AI mode by default.
•⁠  ⁠No blockchain in MVP.
•⁠  ⁠No video diagnosis.
•⁠  ⁠No marketplace.
•⁠  ⁠No OBD integration.
•⁠  ⁠No public storage buckets.
•⁠  ⁠No hardcoded secrets.
•⁠  ⁠Do not expose service role keys to the browser.
•⁠  ⁠Use “Record Confidence Score”, not “Vehicle Condition Score”.
•⁠  ⁠Do not say “certified vehicle”.
•⁠  ⁠Do not say “official ownership document”.
•⁠  ⁠Every important record must have a trust label.
•⁠  ⁠Passport must be a frozen snapshot with SHA-256 hash.
•⁠  ⁠Buyer receives copied vehicle history.
•⁠  ⁠Seller vehicle becomes sold/archived, not deleted.

Development style:
•⁠  ⁠Work phase by phase.
•⁠  ⁠Do not build everything at once.
•⁠  ⁠Before writing code, inspect the existing Next.js version and conventions in ⁠ node_modules/next/dist/docs/ ⁠.
•⁠  ⁠Prefer real data flows over mock screens.
•⁠  ⁠Use Zod validation.
•⁠  ⁠Use loading and error states.
•⁠  ⁠Keep components small.
•⁠  ⁠Keep server-only logic out of client components.
•⁠  ⁠Use translation keys for all visible UI text.
•⁠  ⁠Do not refactor unrelated files.
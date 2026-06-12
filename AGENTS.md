<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->
---

# Vin.ID Project Instructions

Vin.ID is a responsive web app / PWA only.
Do not build React Native or Expo.

Tech stack:
- Next.js App Router
- TypeScript
- Tailwind CSS
- shadcn/ui
- Supabase Auth, Postgres, Storage, RLS
- English/Hebrew localization with RTL support
- Free-tier-first architecture (one scoped paid API is allowed — see **Paid API Scope**)

Core product:
Vin.ID is a smart digital vehicle identity app.
It manages vehicles, maintenance records, issue logs, documents, reminders, and AI-assisted diagnosis.
The core differentiator is Vehicle Passport: a trusted, shareable, tamper-evident vehicle history snapshot for buyers and ownership transfer.

Rules:
- Paid API usage is allowed **only** for document scan / document extraction (see **Paid API Scope**).
- Real Anthropic extraction is allowed **only server-side**.
- Other AI features remain mock/demo unless explicitly approved.
- OCR / PDF scanning is still not broadly implemented unless explicitly scoped.
- Do not add additional paid services without approval.
- No blockchain in MVP.
- No video diagnosis.
- No marketplace.
- No OBD integration.
- No public storage buckets.
- No hardcoded secrets.
- Do not expose service role keys to the browser.
- Use “Record Confidence Score”, not “Vehicle Condition Score”.
- Do not say “certified vehicle”.
- Do not say “official ownership document”.
- Every important record must have a trust label.
- Passport must be a frozen snapshot with SHA-256 hash.
- Buyer receives copied vehicle history.
- Seller vehicle becomes sold/archived, not deleted.

Development style:
- Work phase by phase.
- Do not build everything at once.
- Before writing code, inspect the existing Next.js version and conventions in `node_modules/next/dist/docs/`.
- Prefer real data flows over mock screens.
- Use Zod validation.
- Use loading and error states.
- Keep components small.
- Keep server-only logic out of client components.
- Use translation keys for all visible UI text.
- Do not refactor unrelated files.

## Paid API Scope

Vin.ID now allows a paid API integration for document scanning/extraction only.

Allowed:
- Server-side Anthropic Messages API calls for document image extraction.
- Using `ANTHROPIC_API_KEY` as a server-only environment variable.
- Using `EXTRACTION_MODEL` as a server-only configurable model name.
- Setting `MOCK_AI=false` to enable real document extraction.
- Processing uploaded scan images in memory.
- Downscaling images server-side before sending to the provider.
- Returning structured JSON for user review.
- Creating maintenance or issue records only after explicit user confirmation.

Not allowed without explicit approval:
- Real AI diagnosis replacing mock diagnosis.
- Real OCR/PDF parsing beyond the scoped scan feature.
- Background batch document processing.
- Automatic saving of extracted data without user confirmation.
- Automatic enabling of `share_allowed`.
- Sending document files to additional third-party services.
- Adding payments/subscriptions.
- Adding marketplace features.
- Adding blockchain.
- Adding OBD integrations.

## Document Scan / Extraction Rules

Document scan/extraction must follow these rules:
- All provider calls must run server-side only.
- `ANTHROPIC_API_KEY` must never be exposed to the browser.
- `ANTHROPIC_API_KEY` must never use `NEXT_PUBLIC_`.
- Uploaded scan images are processed in memory and are not persisted unless explicitly implemented later.
- The `vehicle-documents` bucket remains private.
- Signed URLs only for existing private document viewing.
- The scan image must not be stored automatically.
- The extracted data must be shown on a confirmation screen.
- Nothing is saved automatically.
- The user must explicitly confirm before creating a maintenance or issue record.
- The confirmation form must be fully editable.
- If extraction fails, the user must be able to continue manually.
- The app must never crash because the provider failed.
- `share_allowed` must never be turned on automatically.
- Confirmed records may use `trust_level='ai_extracted'`.
- Mileage updates must reuse existing upward-only logic.
- Existing `createMaintenanceLog` / `createIssue` logic should be reused when possible.

## Provider Gating

Provider selection must work like this:
- If `MOCK_AI` is not exactly `"false"`, use mock extraction.
- If `MOCK_AI === "false"` and `ANTHROPIC_API_KEY` exists, use real Anthropic extraction.
- If `MOCK_AI === "false"` but `ANTHROPIC_API_KEY` is missing, fail gracefully or fall back to mock/manual mode depending on current implementation.
- `EXTRACTION_MODEL` may be used to choose the Anthropic model.
- Missing or invalid provider configuration must not break the whole app.

## Cost Control

Because document extraction now uses a paid API, every implementation must consider cost.

Rules:
- Do not call the provider automatically on page load.
- Only call the provider after explicit user action and consent.
- Do not retry aggressively.
- Avoid sending large images.
- Downscale/compress images before sending.
- Do not process PDFs or multi-page files unless explicitly scoped.
- Do not run batch extraction.
- Add TODOs for future usage limits, quotas, and per-user scan caps.
- Keep `MOCK_AI` available for development and fallback.

## Document Security & Passport Rules

Preserve these rules (do not weaken them):
- Do not touch Passport token/security/accept logic unless fixing a real bug.
- Do not expose `storage_path` publicly.
- Do not expose `token_hash`.
- Do not store raw Passport tokens in the DB.
- Public Passport preview must use `snapshot_json` only.
- Buyer must not access the seller’s original rows.
- Accept must copy from `snapshot_json` only.
- Preview must not mark the token used.
- The documents bucket must remain private.
- Do not manually merge `auth.users` records.
- Do not implement destructive automated account deletion yet.

## AI / OCR Status

Current status:
- Document scan/extraction may use the real Anthropic API when configured.
- Mock extraction remains the default/fallback.
- AI diagnosis remains mock/demo unless explicitly approved.
- PDF scanning remains unsupported unless explicitly scoped.
- Document extraction results require user confirmation before saving.
- Real OCR/AI beyond the scoped scan feature is not generally enabled.

## Beta Freeze Policy

Allowed during beta:
- Bug fixes
- Safety/privacy fixes
- UX blockers
- Mobile/PWA polish
- Google login
- Onboarding
- Scoped document scan/extraction fixes
- Anthropic extraction provider fixes
- Cost-control improvements for document scanning

Not allowed without explicit approval:
- Real AI diagnosis
- Paid OCR/PDF processing beyond the scan feature
- Payments
- Blockchain
- Marketplace
- OBD
- Mechanic verification
- Major refactors
- New paid services outside document extraction

## Document Scan & AI Extraction (approved feature state)

The "Scan a document" feature is an approved, shipped feature. This section records its current approved state and **supersedes the earlier "the scan image must not be stored automatically" line where they conflict** (image persistence is now an approved, owner-directed requirement). It does not change any other existing rule.

- Scan/extraction is an approved use of the paid Anthropic API, **server-side only** (see **Paid API Scope** and **Provider Gating**).
- Provider selection: real Anthropic extraction is used whenever `ANTHROPIC_API_KEY` is set (server-only env var); mock is the no-key fallback. `EXTRACTION_MODEL` selects the model (default `claude-haiku-4-5-20251001`).
- Only a **downscaled JPEG** is sent to the provider (cost control). The user's original image is never sent at full resolution.
- User confirmation before save is still required. Nothing is created until the user confirms the editable record; confirmed records may use `trust_label='ai_extracted'`.

### Scan image persistence (approved — reverses the earlier "do not store" rule)

- The **original** uploaded scan image **is now saved** through the existing private documents pipeline into the `vehicle-documents` bucket. The bucket stays **private**.
- The saved document is linked to the created maintenance/issue record (nullable `document_id` FK) so it can be **opened later from the vehicle history**.
- Files are opened only via **short-lived signed URLs generated server-side**. Never expose `storage_path` or file URLs to the browser.
- Reuse the existing documents module (upload, signed-URL generation, soft delete, `contains_personal_info`, `share_allowed`). `share_allowed` defaults **false** and is never auto-enabled; `contains_personal_info` defaults **true** and stays user-editable.
- Persistence is **best-effort**: if saving the document fails, the record is still created (just without an attached document). Images only; PDFs remain unsupported.
- The "open document" path verifies the user owns the vehicle/document before issuing a signed URL.
- Passport stays **metadata-only**: the attached document and `storage_path` must never leak into the Passport snapshot, public preview, or print.

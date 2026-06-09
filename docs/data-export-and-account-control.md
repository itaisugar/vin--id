# Vin.ID — Data Export & Account Control

Beta users can export their own data and request account deletion from
**Settings → Data & privacy**. Everything is generated **on demand**,
server-side, scoped to the signed-in user by Supabase RLS — no background jobs,
no files stored in Supabase, no paid services.

## Exports

All three are authenticated GET routes; a logged-out request gets `401`. A user
can only ever export their own rows (RLS), and the routes use server-only code
(`lib/account/export.ts`).

### JSON — `/api/account/export/json`

A single downloadable `vinid-export-<date>.json` with a `meta` block plus:

- `profile`
- `vehicles`
- `maintenance_logs`
- `issue_logs`
- `vehicle_documents` — **metadata only**
- `reminders`
- `diagnosis_sessions`
- `diagnosis_messages`
- `vehicle_passports` — metadata **and** the frozen `snapshot`
- `ownership_transfers` — rows where the user is seller or buyer

### Maintenance CSV — `/api/account/export/maintenance.csv`

Non-deleted maintenance logs with vehicle make/model/year joined in. Columns:
`vehicle_make, vehicle_model, vehicle_year, date, mileage, category,
description, cost, currency, trust_level, source_type`.

### Issues CSV — `/api/account/export/issues.csv`

Non-deleted issue logs. Columns: `vehicle_make, vehicle_model, vehicle_year,
date, mileage, symptoms, status, severity, resolution_notes, trust_level,
source_type`. This **includes user-entered symptoms** — that's the user's own
data, which is the point of an export.

CSVs are UTF-8 with a BOM so Hebrew / accented text renders correctly in Excel.

## What is excluded (and why)

- **Original uploaded document files** — exports are data/metadata only. Files
  live in a private Storage bucket and are not bundled (see TODOs).
- **`storage_path`** — the internal private-bucket path is stripped from
  document metadata.
- **`owner_user_id`** — internal; stripped from every row.
- **Passport share tokens / `token_hash`** — never stored in exportable tables;
  `transfer_tokens` is **not** exported at all.
- **`beta_feedback`** — insert-only by RLS (not readable back, by design), so it
  is not included in the export.
- **`app_events`** — product analytics, intentionally excluded from user export.
- **Service-role key / signed URLs** — never involved; exports use the user's
  own RLS-scoped session only.

### Why raw document files are excluded

Bundling the actual files would mean generating signed URLs or streaming bytes
out of the private bucket on demand — extra memory, egress, and a larger attack
surface — for little MVP value. The metadata (type, dates, vendor, amount, trust
label) is exported instead. A proper file-bundle export is a future TODO.

## Account deletion (request-based in beta)

Automated deletion is **not** enabled in beta. The **Request deletion** button
records a `beta_feedback` row with `type='deletion_request'` (migration
`20260608050000_beta_feedback_deletion_request.sql` widens the type CHECK). The
team then handles deletion manually.

This phase deliberately does **not**:
- delete account data automatically,
- delete `auth.users`,
- delete Storage files.

Why request-based: automated, irreversible deletion across many tables + Storage
+ the auth user is risky to get right and easy to get wrong during a beta. A
manual step keeps it safe and reviewable until a vetted workflow exists.

## Security

- Export routes require auth; logged-out → `401`.
- RLS scopes every query to the current user; no service-role key in the app.
- No `token_hash`, no raw Passport tokens, no `storage_path`, no signed URLs in
  exports.
- No public/anon DB policies added. Export generation is server-only.
- Responses are `cache-control: no-store` and sent as downloads.

## Free-tier notes

- Generated on demand, in memory; nothing stored in Supabase.
- Fine for beta-sized accounts. **TODO**: paginate/stream JSON & CSV if an
  account ever holds very large history.

## Future TODOs

- Full, vetted **account-deletion workflow** (data + auth user + Storage), likely
  admin-reviewed.
- **Document file bundle** export (zip of original files) with safe signed access.
- **Storage cleanup** of orphaned files on document/vehicle removal.
- **Admin deletion workflow** to action `deletion_request` feedback rows.
- Export pagination/streaming for very large accounts.

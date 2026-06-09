# Vin.ID — Data Safety & Snapshot Integrity Review

Pre-beta review of data safety: RLS, soft-delete consistency, Vehicle Passport
snapshot immutability, and sensitive-data leakage. This documents the
guarantees and how they're enforced, plus what to verify before beta.

Companion docs: [snapshot-integrity-test.md](snapshot-integrity-test.md),
[manual-backup-checklist.md](manual-backup-checklist.md),
[data-export-and-account-control.md](data-export-and-account-control.md),
[event-tracking.md](event-tracking.md),
[passport-qa-checklist.md](passport-qa-checklist.md).

## Tables with RLS (owner-scoped)

RLS is **enabled on every user table**, default-deny, scoped to the owner:

`profiles`, `vehicles`, `maintenance_logs`, `issue_logs`, `vehicle_documents`,
`document_extractions`, `reminders`, `diagnosis_sessions`,
`diagnosis_messages`, `vehicle_passports`, `transfer_tokens`,
`ownership_transfers`, `audit_logs`, `beta_feedback`, `app_events`.

Notes:
- Most use `owner_user_id = auth.uid()` for select/insert/update/delete.
- `ownership_transfers` is visible to **either party** (`from_user_id` or
  `to_user_id`).
- `beta_feedback` and `app_events` are **insert-only** (no select policy) — users
  can't read them back. The anonymous Passport-preview event is written by a
  `SECURITY DEFINER` function that stores only `passport_id` (never the token).
- **No public/anon SELECT policies** exist on any table. The public Passport
  preview is served by `SECURITY DEFINER` RPCs that return curated snapshot data
  only.

## Soft-delete expectations

User content uses `deleted_at` (soft delete); vehicles use `status`
(`active`/`archived`/`sold`) and are never hard-deleted.

Verified: every list path filters `deleted_at is null` —
`listMaintenanceLogs`, `listIssues`, `listDocuments`, `listReminders`,
`listPassports`/`getPassport`, and `listVehicles`/`getVehicleById`. Because the
Passport snapshot is built from these list functions, **deleted records never
enter a snapshot**, and therefore never reach the public preview, print/PDF, or
an accepted transfer (which all read the snapshot only).

Exports:
- **CSV** (maintenance, issues) filter `deleted_at is null`.
- **JSON** export filters `deleted_at is null` on every table that has the
  column (vehicles, maintenance_logs, issue_logs, vehicle_documents, reminders,
  diagnosis_sessions, vehicle_passports). *(Fixed in Phase 6H-lite — previously
  the JSON export returned soft-deleted rows.)*

Dashboard: active vehicle lists and reminder roll-ups filter
`status = 'active'` + `deleted_at is null`; archived/sold vehicles appear only in
their explicit "Archived & sold" section.

## Snapshot immutability expectations

A Vehicle Passport is a **frozen** `vehicle_passports.snapshot` (jsonb) plus a
canonical-JSON **SHA-256** `snapshot_hash`. The snapshot is written once at
creation and is the single source of truth for:

- **Public preview** (`/p/[token]`) — served by `get_public_passport` which
  returns curated fields from `snapshot` only (strips `meta.issuer_user_id`); it
  **never** reads live seller rows and never mutates token/passport state.
- **Print / PDF** (`/vehicles/[id]/passports/[passportId]/print`) — renders from
  `passport.snapshot` only.
- **Accept transfer** (`accept_passport`) — copies into the buyer's account
  **from the snapshot only** (`jsonb_to_recordset` over `snapshot->...`), never
  from the seller's live tables. Document files are not copied (`storage_path`
  stays NULL).

Therefore **editing seller data after creation does not change any existing
Passport** (display, hash, or what a buyer receives). State is respected:
`revoked` / `accepted` / `expired` (and token `revoked`/`used`/`expired`) all
short-circuit the preview and accept paths.

See [snapshot-integrity-test.md](snapshot-integrity-test.md) for the manual test.

## Public preview safety rules

- Only a curated subset leaves the DB (status, issued/expires, snapshot_hash,
  score, snapshot, ai_summary). Never `owner_user_id`/`issuer_user_id`,
  `public_id`, `server_signature`, `storage_path`, or the token hash.
- Viewing is read-only and does not consume the token.
- `proxy.ts` does not redirect `/p/*`; the page is `noindex`.

## Export safety rules

- Export routes **require auth**; logged-out → `401`. RLS scopes every query to
  the current user. No service-role key in app code.
- Stripped/excluded: `owner_user_id` (all rows), `storage_path` (documents),
  `transfer_tokens` (token_hash) entirely, `app_events`, and `beta_feedback`.
- No signed URLs, no raw files, no raw tokens, no token hashes.

## Sensitive-data leakage review (results)

| Concern | Snapshot | Public preview | Print/PDF | JSON export | CSV export | Events |
| --- | --- | --- | --- | --- | --- | --- |
| `storage_path` | ❌ never added | ❌ | ❌ | ❌ stripped | ❌ | ❌ |
| `token_hash` | ❌ (separate table) | ❌ | ❌ | ❌ (table excluded) | ❌ | ❌ |
| raw token | ❌ not stored anywhere | ❌ | ❌ | ❌ | ❌ | ❌ |
| `owner_user_id` | meta issuer stripped on preview | stripped | n/a (owner-only) | stripped | n/a | n/a |

The raw Passport token is never persisted (only `sha256` hash in
`transfer_tokens`). `app_events` metadata is sanitized in `lib/analytics/track.ts`
(forbidden keys + substring filter, no nested objects, strings truncated).

### Event metadata privacy audit

Run `supabase/audits/app_events_privacy_audit.sql` in the SQL Editor (also in
[beta-insights.md](beta-insights.md)). The forbidden-key / forbidden-value
queries check for: `vin, license_plate, storage_path, token, token_hash,
symptoms, diagnosis, email, phone, address, file_name, filename`. **Each should
return 0 rows.** If a row appears: identify the `event_name`, fix the offending
`trackEvent(...)` call site, then delete the bad rows
(`delete from public.app_events where id = '...';`).

## Known limitations

- `diagnosis_messages` has no `deleted_at`; messages belonging to a
  soft-deleted diagnosis session still appear in the JSON export (own data only).
- `server_signature` on passports is reserved (currently null) — hashing is the
  tamper-evidence mechanism today.
- Document **files** are never copied on accept or included in exports
  (metadata only) — by design.
- No automated deletion or automated backups (see the manual checklists).

## What to check before beta

1. Soft-delete: remove a maintenance/issue/document/reminder → gone from the
   vehicle page, a **new** Passport snapshot, and the JSON/CSV exports.
2. Snapshot immutability: run [snapshot-integrity-test.md](snapshot-integrity-test.md).
3. Leakage: search a JSON export and a `/p/[token]` page source for
   `storage_path`, `token_hash`, and a bucket name → none present.
4. Events: run the privacy audit queries → 0 rows.
5. RLS: confirm RLS is ON for every table and there are no public SELECT
   policies (Supabase → Database → Policies).
6. Backups: complete [manual-backup-checklist.md](manual-backup-checklist.md).

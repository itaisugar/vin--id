# Supabase — Database (Phase 2A)

This directory holds the Vin.ID database schema as SQL migrations.

```
supabase/
└── migrations/
    └── 20260607120000_init_core_schema.sql
```

Phase 2A is **database only**: tables, Row Level Security (RLS), policies,
indexes, and helper triggers. No application UI and no business logic are part
of this phase.

## 1. How to run the SQL manually (Supabase SQL Editor)

You do not need the Supabase CLI for this phase.

1. Open your project in the [Supabase dashboard](https://supabase.com/dashboard).
2. Go to **SQL Editor** → **New query**.
3. Open `migrations/20260607120000_init_core_schema.sql`, copy its **entire**
   contents, and paste it into the editor.
4. Click **Run**.

The script is idempotent at the function/trigger level (`create or replace`,
`drop trigger if exists`) but the `create table` statements are not — they will
error if the tables already exist. Run it once on a clean schema. To re-run from
scratch in a dev project, drop the tables first (or reset the database) and run
again.

After running, verify in **Table Editor** that all 13 tables exist and that each
shows the green **RLS enabled** indicator.

> Later phases will add migrations as new timestamped files in
> `migrations/`. If/when the Supabase CLI is adopted, these same files work with
> `supabase db push` / `supabase migration up`.

## 2. RLS must remain enabled

Row Level Security is **enabled on every table** in this migration and must stay
that way. The policies restrict each user to **only their own rows**
(`owner_user_id = auth.uid()`), with ownership-transfer rows visible to both the
seller and the buyer.

- Do **not** disable RLS on any table.
- Do **not** add public/`anon` `SELECT` policies (see passport note below).
- Server-side code that legitimately needs to bypass RLS must use the
  **service role key on the server only** — never in the browser.

## 3. Storage bucket — `vehicle-documents` (Phase 2E)

Phase 2E introduces a **private** Storage bucket for vehicle document files.
There are **no public buckets** (per project rules); files are served only via
short-lived signed URLs generated server-side.

**To set it up, run the migration**
`migrations/20260607170001_storage_vehicle_documents.sql` in the **SQL Editor**.
It is idempotent and does two things:

1. Creates the private bucket `vehicle-documents` (`public = false`) with a
   **5 MB** size limit and allowed types `application/pdf, image/jpeg,
   image/png, image/webp`.
2. Adds owner-only RLS policies on `storage.objects` (select/insert/update/
   delete) that require the **first path segment to equal the user's id**.

Path convention for every object:

```
{user_id}/{vehicle_id}/{document_id}/{safe_filename}
```

Prefer running the SQL. If you set the bucket up via the **Dashboard → Storage**
instead, make sure: bucket name is exactly `vehicle-documents`, **Public** is
**off**, then add the four `storage.objects` policies from the migration file.

> Verify in **Storage** that `vehicle-documents` exists and is **not public**,
> and in **Authentication → Policies / storage.objects** that the four
> `vehicle_documents_objects_*` policies are present.

## 4. Public passport preview is intentionally not exposed

`vehicle_passports` has **no public/anon read policy**. The shareable public
preview (looked up via `vehicle_passports.public_id`) will be served later by a
**trusted server route/function** using the service role — not through RLS.
`transfer_tokens` stores only a **`token_hash`** (never the raw token); tokens
are matched server-side by hashing the presented value.

## 5. UI is not implemented in this phase

No screens, forms, or Vehicle CRUD UI are part of Phase 2A. Application code
(Next.js pages, components, server actions) will be added in later phases.

## Tables in this migration

| Table | Purpose | Soft delete | RLS scope |
| --- | --- | --- | --- |
| `profiles` | 1:1 with `auth.users` (auto-created on signup) | — | self (`id = auth.uid()`) |
| `vehicles` | Vehicles; `status` = active / archived / sold | `deleted_at` | owner |
| `maintenance_logs` | Service/maintenance records | `deleted_at` | owner |
| `issue_logs` | Reported issues | `deleted_at` | owner |
| `vehicle_documents` | Document metadata (private storage path) | `deleted_at` | owner |
| `document_extractions` | OCR/AI extraction output (schema only) | — | owner |
| `reminders` | Service/inspection/insurance reminders | `deleted_at` | owner |
| `diagnosis_sessions` | AI diagnosis sessions (schema only) | `deleted_at` | owner |
| `diagnosis_messages` | Diagnosis messages (immutable) | — | owner |
| `vehicle_passports` | Frozen snapshot + SHA-256 hash; status draft / active / revoked / expired / accepted | `deleted_at` | owner only (no public) |
| `transfer_tokens` | Transfer links; **`token_hash` only** | — | issuer (owner) |
| `ownership_transfers` | Seller → buyer transfer records | — | both parties |
| `audit_logs` | Append-only audit trail (immutable) | — | owner |

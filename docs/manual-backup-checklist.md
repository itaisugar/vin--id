# Vin.ID — Manual Backup Checklist (pre-beta)

Free-tier, **manual** backups. No automated backups, no cron jobs, no paid
backup services in this phase — those may require a paid Supabase plan or
external tooling later (see the note at the end).

Do this once before opening the beta, and again before any risky change
(migrations, bulk edits).

## 1. Database backup from the Supabase dashboard

Depending on your plan, one of these is available:

- **Paid plans** — Supabase keeps automatic daily backups: Dashboard →
  **Database → Backups**. Confirm a recent backup exists / trigger one if the UI
  allows. (Free tier usually does **not** include automated backups.)
- **Any plan, via CLI (recommended for Free tier)** — a full logical dump with
  `pg_dump` using the connection string from **Project Settings → Database**:
  ```bash
  # Schema + data (roles/owners excluded for portability)
  pg_dump "$SUPABASE_DB_URL" --no-owner --no-privileges -F p -f vinid-backup.sql
  ```
  Store `vinid-backup.sql` somewhere private (it contains user data — treat it
  like secrets). Do **not** commit it to git.

## 2. Export key tables as CSV (Table Editor)

Quick, no tooling. Supabase Dashboard → **Table Editor** → open each table →
**Export → CSV**. Back up at least:

- `profiles`
- `vehicles`
- `maintenance_logs`
- `issue_logs`
- `vehicle_documents` (metadata only — see storage note below)
- `reminders`
- `diagnosis_sessions`, `diagnosis_messages`
- `vehicle_passports` (includes the frozen `snapshot`)
- `transfer_tokens`, `ownership_transfers`
- `beta_feedback`, `app_events`

Keep the CSV set together with the date. These are point-in-time copies, not a
restorable backup by themselves — prefer the `pg_dump` in step 1 for restore.

## 3. Recommended pre-beta backup steps

1. Run a `pg_dump` (step 1) and store it privately, dated.
2. Export the key tables as CSV (step 2) as a convenience copy.
3. Note the current migration state (which files in
   `supabase/migrations/` have been applied).
4. Confirm RLS is ON for every table and there are no public SELECT policies.
5. Record the Supabase project ref and region somewhere safe.

## 4. Storage bucket reminder

- The **`vehicle-documents`** bucket is **private** (owner-scoped policies on
  `storage.objects`). Keep it private.
- **Document files are NOT included** in the JSON/CSV exports or in a `pg_dump`
  of the database — they live in Storage, not Postgres. To back up the actual
  files you must download them separately (Dashboard → Storage, or the Storage
  API). For a small beta this is optional; note it as a gap.

## 5. Note on automated backups

Full automated / point-in-time backups generally require a **paid Supabase
plan** or **external setup** (scheduled `pg_dump` to your own storage). This is
intentionally **out of scope** for the free-tier beta. TODO: revisit a scheduled
backup strategy (and Storage file backup) before any non-beta launch.

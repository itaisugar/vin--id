# Fleet Lite Phase 1 — Runtime Validation Runbook

**Status when written: BLOCKED.** Runtime validation of the tenancy migration
was NOT performed, because this workstation has:

- no container runtime (no Docker / Colima / Podman) → `supabase start` cannot
  run a local database, and
- only one Supabase project available (`jsthfmgvcdrfzpgkpwvt`, "vin - id"), which
  is what `.env.local` points the app at and contains real beta-user data —
  i.e. production. The Critical Safety Rule forbids running migrations or auth
  tests against it.
- no `SUPABASE_ACCESS_TOKEN`, so a staging project cannot be created
  non-interactively.

This runbook is the exact procedure to run once ONE of the two allowed
environments exists. Do **not** run any of it against `jsthfmgvcdrfzpgkpwvt`.

---

## Step 0 — Provision a non-production database (pick one)

### Option A — Local Supabase (preferred; free, disposable)

Requires a container runtime. Install one first:

```bash
brew install colima docker docker-compose   # or Docker Desktop
colima start --cpu 4 --memory 8
```

Then, from the repo root:

```bash
cd /Users/itai/Desktop/vin.id/vin-id
supabase init          # creates supabase/config.toml (not yet present)
supabase start         # boots local Postgres + Auth + Storage in Docker
```

`supabase start` prints local `API URL`, `anon key`, `service_role key`, and a
direct `DB URL`. Use those below — never the production values.

### Option B — Dedicated staging project (hosted)

```bash
export SUPABASE_ACCESS_TOKEN=<personal access token from supabase.com/dashboard/account/tokens>
supabase projects create "vin-id-staging" --org-id souhmsxdwlsqslgmtidt --region <region>
# Link a SEPARATE working copy to it — do NOT relink the production checkout:
supabase link --project-ref <STAGING_REF>
```

Confirm the linked ref is the STAGING ref, not `jsthfmgvcdrfzpgkpwvt`, before
proceeding:

```bash
cat supabase/.temp/project-ref   # must NOT be jsthfmgvcdrfzpgkpwvt
```

---

## Step 1 — Apply the full migration history

The two Fleet migrations depend on the whole prior schema, so apply everything
in order (they are the last two by timestamp).

**Local:**
```bash
supabase db reset          # applies every file in supabase/migrations/ to the local DB
```

**Staging:**
```bash
supabase db push           # applies unapplied migrations to the linked staging project
```

Watch the output for this line from `20260722120000_fleet_organizations.sql`:

```
WARNING: table <name>: <N> row(s) could not be assigned an organization; column left NULLABLE.
```

- On a **clean** DB there are no rows, so no warning — expected.
- On a **seeded** DB (Step 4) any warning means an owner had no profile row.
  Investigate before trusting NOT NULL; do not proceed past it.

### Reapply-safety check
Both migrations are idempotent (`add column if not exists`, `drop policy if
exists`, `create index if not exists`, guarded `set not null`). Verify:

```bash
# Local: run the two files a second time directly — must succeed with no error.
psql "$LOCAL_DB_URL" -f supabase/migrations/20260722120000_fleet_organizations.sql
psql "$LOCAL_DB_URL" -f supabase/migrations/20260722130000_fleet_vehicle_fields.sql
```

---

## Step 2 — Run the tenancy audit (must be all-zero)

```bash
psql "$DB_URL" -f supabase/audits/fleet_tenancy_audit.sql
```

Every SELECT must return **0 rows**; the two `do $$` blocks must emit only
`ok <table>` notices and **no** `FAIL` warnings. Pay closest attention to:

- **Query 5** — no surviving `owner_user_id`-only policy. A non-empty result
  here means org scoping AND the viewer role are silently defeated.
- **Query 7** — `anon` has no table privileges. Supabase sometimes grants to
  `anon` via its own default privileges; if this returns rows, add explicit
  `revoke ... from anon` and re-audit. Do NOT delete the audit query to pass.

---

## Step 3 — Authenticated tenant tests (clean DB)

Create the three personas. **User creation** may use the service role (it is
setup, not an assertion). **All access-control assertions must use real signed-in
sessions (anon key + password sign-in), never the service role.**

Personas:
- **User A** — owner of Org A
- **User B** — non-owner of Org A (set `role='viewer'` in SQL to also cover the
  read-only case; re-run as `fleet_manager` to cover the writer case)
- **User C** — owner of Org B

Because signup auto-provisions a *personal* org per user (the `handle_new_user`
trigger), put A and B in the same org by, after both sign up, updating B:

```sql
-- setup only (service role / SQL editor):
update public.profiles
   set organization_id = (select organization_id from public.profiles where id = '<A_id>'),
       role = 'viewer'
 where id = '<B_id>';
-- delete B's now-orphaned personal org if desired.
```

A ready-to-run harness is provided at
`scripts/validation/fleet-tenancy-check.mjs` (see Step 6). It:
1. creates A/B/C via the Auth admin API (setup),
2. signs each in with the **anon** key to get real JWT-scoped clients,
3. asserts, for every org-scoped table
   (`vehicles`, `maintenance_logs`, `issue_logs`, `vehicle_documents`,
   `document_extractions`, `reminders`, `vehicle_passports`, `transfer_tokens`,
   `vehicle_insurance`, `vehicle_registration`, `vehicle_inspection`):
   - C cannot `select` / `update` / `delete` any Org A row (0 rows / 0 affected),
   - C cannot `insert` a row referencing an Org A vehicle,
   - B (viewer) cannot `insert` / `update` / `delete` (RLS `is_org_writer()`),
   - A (owner) can read+write Org A rows,
   - guessing a known Org A row id as C still returns nothing.

Run it against the non-prod URL/keys and require a non-zero exit on any failure.

---

## Step 4 — Migration against a seeded (existing-data) DB

Re-provision a fresh DB, seed it to mimic pre-migration production, then migrate.

1. `supabase db reset` but stop before the fleet migrations — or seed after a
   full reset and manually null out `organization_id` on a couple of rows to
   simulate legacy data, then re-run migration 1's backfill block.
2. Seed: 2 auth users, each with a profile, a few vehicles + maintenance/issues/
   documents/reminders per user.
3. Apply the two fleet migrations.
4. Assert:
   - every `profiles` row got an `organization_id` and a valid role,
   - every seeded child row got its owner's `organization_id`
     (audit queries 3 + 4 cover this),
   - the two users landed in **different** organizations (no cross-mixing),
   - no orphaned rows (audit query 2).

---

## Step 5 — Passport lifecycle + public-leak checks

Using A's authenticated session:
1. create a vehicle, add maintenance/issue/document/reminder rows,
2. create a passport (`/vehicles/[id]/passports/new`) → note the one-time token,
3. open `/p/<token>` while **signed out** — must render, and must NOT contain:
   `organization_id`, `assigned_driver_phone`, `operational_status`,
   `storage_path`, any signed URL, or any Org member detail. Grep the raw HTML
   and the `get_public_passport` RPC JSON for those strings — expect none.
4. as User C (Org B, signed in), accept the passport → a copied vehicle appears
   in **Org B**; assert every copied child row has `organization_id = Org B`
   (not Org A), and the seller's original rows still have `organization_id = Org
   A` and the seller vehicle is now `status='sold'`. (Acceptance COPIES from the
   snapshot into the buyer's org via the auto-fill trigger; it never MOVES rows,
   so no record is left in the wrong org.)
5. re-open `/p/<token>` — must show "already accepted"; a second accept must be
   rejected (no replay).

---

## Step 6 — Gates

```bash
./node_modules/.bin/tsc --noEmit     # expect exit 0
./node_modules/.bin/eslint .         # expect exit 0
npm run build                        # expect "Compiled successfully"
```

These three were executed and PASS as of this writing. Everything in Steps 1–5
is UNVERIFIED pending a non-production database.

---

## What is proven vs unproven today

| Check | Status |
|-------|--------|
| tsc / eslint / build | ✅ executed, pass |
| Static review of migration/RLS/audit/services | ✅ done — no blocking bug found |
| Migrations apply (clean) | ❌ blocked — no non-prod DB |
| Migrations apply (seeded) + backfill correctness | ❌ blocked |
| Audit queries return zero rows | ❌ blocked |
| Cross-org read/write blocked (real JWTs) | ❌ blocked |
| Role enforcement (viewer read-only) | ❌ blocked |
| Passport public-leak | ❌ blocked (static field-list review only) |
| Passport accept org propagation | ❌ blocked |

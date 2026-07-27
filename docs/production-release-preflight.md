# Production release preflight — Fleet Lite

**Status: BLOCKED. Do not run `supabase db push` against production.**

Target: `jsthfmgvcdrfzpgkpwvt` (vin - id, West EU / Ireland)
Preflight run: 2026-07-26, read-only, from commit `b73358b`
Release candidate: `fleet-lite-phase-1` → 16 new migrations
Rollback tag: `pre-fleet-lite-production-20260726-2307` → `b2e2ce0`

---

## The blocker

Production has **2 auth users but only 1 profile row**. The user without a
profile — `e2faa5ed-ea9e-4456-bf03-936e2e6d58c1`, created 2026-06-08 — owns most
of the data in the database.

`20260722120000_fleet_organizations.sql` creates one personal organization per
row in `public.profiles` and backfills `organization_id` from the owner's
profile. A user with no profile therefore gets no organization, and every row
they own keeps `organization_id = NULL`. Because that column is nullable, **the
migration succeeds** — it reports no error at all — and every one of those rows
becomes permanently invisible, since all the new RLS policies are
`organization_id = public.current_org_id()` and `NULL` never matches.

What would silently disappear:

| Table | Rows in production | Owned by the profile-less user | Lost |
| --- | --- | --- | --- |
| `maintenance_logs` | 7 | 7 | **100%** |
| `vehicle_documents` | 3 | 3 | **100%** |
| `document_extractions` | 2 | 2 | **100%** |
| `vehicle_passports` | 14 | 10 | 71% |
| `issue_logs` | 6 | 4 | 67% |
| `vehicles` | 5 | 3 | 60% |
| `reminders` | 2 | 1 | 50% |

### This was reproduced, not inferred

A local database was built to production's exact shape — the pre-Fleet migration
chain, two auth users, one profile deleted, vehicles owned by the profile-less
user — and the 16 release migrations were applied to it. All 16 reported `OK`.
Then, querying as the orphaned owner through real RLS:

```
orphaned owner sees | no_org | vehicles_visible | logs_visible
                    |   t    |        0         |      0
ACTUALLY IN TABLE   |        |        3         |
```

The rows exist. Nobody can see them. There is no error and nothing to roll back
to signal the loss.

### Why a profile is missing

Unknown, and worth establishing before repairing. `handle_new_user` creates a
profile for every new auth user, so this row was most likely deleted later —
possibly during earlier account-deletion or beta testing. Confirm whether that
user account is still wanted before choosing a fix.

### Fix before releasing

Decide which case applies, then re-run this preflight.

* **The account is still in use** → recreate its profile so the migration's
  backfill can see it:
  ```sql
  insert into public.profiles (id, full_name)
  select u.id, u.raw_user_meta_data->>'full_name'
  from auth.users u
  left join public.profiles p on p.id = u.id
  where p.id is null;
  ```
* **The data belongs to the remaining user** → re-point ownership first, then
  migrate. Show exactly which rows move before running anything.
* **The account and its data are abandoned** → confirm that in writing before
  deleting anything. Deleting production rows to make a migration pass is not
  an acceptable default.

A defensive follow-up worth adding to the migration itself: after the backfill,
`raise exception` if any organization-scoped table still holds a NULL
`organization_id`. Failing loudly beats succeeding silently.

---

## Second blocker: migration history is empty

`supabase migration list --linked` reports **zero** applied migrations, while the
schema is clearly at `20260611130000` (verified table by table). Production was
therefore built without `supabase db push` — probably applied by hand.

Consequence: `db push` would start at `20260607120000_init_core_schema.sql`,
which contains 13 bare `CREATE TABLE` statements, and abort on the first one.
The failure is safe (nothing is applied) but the release cannot proceed.

The standard remedy is `supabase migration repair --status applied <version>`
for each of the 20 migrations already reflected in the schema. **That was
deliberately not done here**: it rewrites production's migration history, and it
should only happen once a full schema diff confirms production matches those 20
files exactly. Get that diff first.

---

## What is clean

Every other preflight check passed, from the verified backup:

| Check | Result |
| --- | --- |
| profiles without an auth user | 0 |
| records referencing a missing vehicle | 0 across all 6 record tables |
| documents with more than one confirmed extraction | 0 — the new unique index builds cleanly, and `20260726110000` is a no-op here |
| transfer tokens not stored as SHA-256 | 0 |
| transfer tokens with a missing passport | 0 |
| passports with more than one active token | 0 |
| negative maintenance cost | 0 |
| `vehicle-documents` bucket public | no — private, correct |
| invalid status / severity / trust values | none |

Passport statuses (`active`, `revoked`, `accepted`) and token statuses
(`active`, `revoked`, `used`) are all expected values.

---

## Migration compatibility, once the blocker is fixed

Verified by applying all 16 migrations to a production-shaped database seeded
with a **profiled** user:

* the user receives an organization and an `owner` membership,
* `organization_id` is backfilled on vehicles, maintenance, issues, documents
  and passports — zero nulls,
* signed in through real RLS they see all their records,
* a different authenticated user sees zero,
* anonymous is refused outright.

**Deployment order: migrations first, then the application.** The old build
keeps working across the migration — it filters by `owner_user_id`, which stays
present, and its inserts satisfy the new policies because the backfilled user is
an `owner` and therefore an org writer. No maintenance window is needed.

---

## Release readiness of the code itself

The local gate was re-run in full at `b73358b`:

* 524 assertions across 7 suites, 0 failures
* 6 SQL audits, 0 findings
* clean 36-migration chain; legacy upgrade with duplicate rows preserved
* TypeScript, ESLint, production build clean
* release diff: no secrets, no keys, no local URLs in application code, no
  disabled RLS, no permissive `using (true)`, no deleted or renamed routes

The code is ready. The database is not.

---

## Order of operations to unblock

1. Decide what to do about `e2faa5ed-…` and its data. Re-run this preflight.
2. Take a full schema diff of production against the expected
   `20260611130000` state.
3. Only if it matches, repair the migration history for those 20 versions.
4. Re-take a backup.
5. `supabase db push` — expect exactly the 16 new migrations.
6. Verify: every organization has an owner, no organization-scoped table holds a
   NULL `organization_id`, and the founder can see every pre-existing record.
7. Deploy the application, then smoke-test.

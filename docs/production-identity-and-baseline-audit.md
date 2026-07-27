# Production identity and migration-baseline audit

Companion to [`production-release-preflight.md`](./production-release-preflight.md).

Target: `jsthfmgvcdrfzpgkpwvt` (vin - id, West EU / Ireland)
Run: 2026-07-27, **read-only throughout** — every session opened with
`default_transaction_read_only = on`; no insert, update, delete, migration,
`migration repair`, merge or deploy was performed.
Evidence: a fresh schema + data dump taken at 09:43, byte-identical to the
2026-07-26 23:08 backup apart from pg_dump's random nonce comments, so nothing
changed in production between the two.

**Outcome: two decisions are needed from the founder. The schema baseline is
provably safe to repair; the identity question is not mine to answer.**

---

## Part 1 — Identity

Two Auth users, one profile. Both accounts are real, confirmed, active, and
neither is banned or soft-deleted.

| | Account A | Account B |
| --- | --- | --- |
| user id | `e2faa5ed-ea9e-4456-bf03-936e2e6d58c1` | `b3c52640-74b0-401b-92d9-3b27eaea7dc7` |
| email | `i***@gmail.com` | `y***@gmail.com` |
| created | 2026-06-08 01:45:40 | 2026-06-08 08:57:23 |
| **last sign-in** | **2026-07-24 13:28** | 2026-07-25 12:27 |
| email confirmed | yes | yes |
| provider | email | email |
| **profile row** | **MISSING** | present |

Profiles with no Auth user: 0.

### The profile was deleted, not never-created

`on_auth_user_created` exists on `auth.users` in production, is **enabled**, and
executes `handle_new_user()`. It was installed by `20260607120000`, a day before
both accounts were created — so account A *did* receive a profile at signup and
it was removed afterwards.

Nothing in the application recorded the removal: `audit_logs` is empty and
`beta_feedback` has zero rows, so no in-app deletion request exists. The
deletion therefore happened through the Dashboard or direct SQL.

### Account A works today and would break on release

The deployed build (`origin/main`) scopes every vehicle query by
`owner_user_id = auth.uid()` and never reads `profiles`. Account A can
therefore use the app normally right now. It is the Fleet migration — which
derives organizations from `profiles` — that would silently strip its access.

Its last recorded in-app activity (`app_events`) is 2026-06-27: 10 document
scans, 4 maintenance records created, 3 Passports created, 1 public preview
opened. It signed in again on 2026-07-24 without generating events.

---

## Part 2 — Ownership inventory

Account A owns the majority of production, including **100%** of three tables.

| Table | Account A | Account B | Relationship | Reaches user via |
| --- | --- | --- | --- | --- |
| `vehicles` | 3 | 2 | direct | `owner_user_id` |
| `maintenance_logs` | **7** | 0 | direct + vehicle | both |
| `vehicle_documents` | **3** | 0 | direct + vehicle | both |
| `document_extractions` | **2** | 0 | direct + vehicle | both |
| `vehicle_passports` | 10 | 4 | direct + vehicle | both |
| `transfer_tokens` | 10 | 4 | direct + vehicle | both |
| `issue_logs` | 4 | 2 | direct + vehicle | both |
| `reminders` | 1 | 1 | direct + vehicle | both |
| `diagnosis_sessions` | 3 | 2 | direct + vehicle | both |
| `diagnosis_messages` | 6 | 4 | direct | `owner_user_id` |
| `app_events` | 18 | 12 | direct | `user_id` |
| `ownership_transfers` | 1 (`from_user_id`) | 1 (`to_user_id`) | direct | both columns |
| `vehicle_insurance` / `registration` / `inspection` | 0 | 0 | — | — |

Every child row carries **both** a direct `owner_user_id` and a `vehicle_id`.
Changing vehicle ownership alone would therefore **not** be sufficient: the
`owner_user_id` columns are independent and drive Passport ownership and the
current Storage policies.

### Foreign keys — 21 of them, and 16 cascade

An earlier note in the preflight document said production had no foreign keys to
`auth.users`. **That was wrong**, and the correction matters. It came from
reading `supabase db dump` output, which omits cross-schema constraints; the
live catalogue shows 21 such foreign keys.

* **16 × `ON DELETE CASCADE`** — `profiles`, `vehicles`, `maintenance_logs`,
  `issue_logs`, `vehicle_documents`, `document_extractions`, `reminders`,
  `vehicle_passports`, `transfer_tokens`, `vehicle_insurance`, `registration`,
  `inspection`, `diagnosis_sessions`, `diagnosis_messages`, `audit_logs`,
  `ownership_transfers.from_user_id`
* **5 × `ON DELETE SET NULL`** — `app_events.user_id`, `beta_feedback.user_id`,
  `ownership_transfers.to_user_id`, `transfer_tokens.used_by_user_id`,
  `vehicle_passports.accepted_by_user_id`

`vehicles` additionally cascades to 12 child tables. **Deleting Auth user A
would destroy all of its data irreversibly, in one statement, with no
confirmation.** No reassignment is blocked by a foreign key, because every
target row would still point at a valid user.

---

## Part 3 — The three scenarios

The evidence is consistent with an active second account, but *who owns these
two Gmail addresses is not something the database can tell me*. The founder
must choose.

### Scenario A — valid account, recreate the missing profile

* **Change:** insert one `profiles` row. Nothing else.
* **Rows affected:** 1 insert. Zero existing rows modified.
* **Result:** each account gets its own personal organization at migration time
  and keeps everything it owns.
* **Risk:** low. Reversible by deleting the row again before the Fleet
  migrations run.
* **After migration:** two separate organizations. **Sub-decision:** if both
  addresses are the founder's and the data should live together, Scenario A
  alone does not merge them — that needs Scenario B, or a membership change
  after the release.
* **Auth deletion safe afterwards?** No — still cascades.
* **Verification:** see Part 4.

### Scenario B — obsolete account, move its data to Account B

* **Change:** update `owner_user_id` on 8 tables plus `app_events.user_id` and
  `ownership_transfers.from_user_id` — **41 rows** in total.
* **Risk:** medium. Passport and transfer-token ownership move with it, and
  `storage_path` values keep Account A's uid as their first path segment
  (see Part 6). Vehicle ids do not change, so no duplicates are created.
* **Rollback:** the reverse update, keyed on the same row ids. Capture the id
  list before running.
* **Auth deletion safe afterwards?** Only once **every** column above is moved.
  A single missed row would be cascade-deleted.
* **Do not** combine with a delete in the same change.

### Scenario C — test data, delete it

* **Change:** delete Auth user A.
* **Rows affected:** cascades to at least **57 rows** across 12 tables —
  3 vehicles, 7 maintenance logs, 3 documents, 2 extractions, 10 Passports,
  10 transfer tokens, 4 issues, 1 reminder, 3 diagnosis sessions,
  6 diagnosis messages, 1 ownership transfer — plus 18 `app_events` rows
  nulled and 3 Storage objects left orphaned.
* **Risk:** **highest, and irreversible.** This is 100% of production's
  maintenance history, documents and extractions.
* **Rollback:** restore from backup only.
* This scenario is not recommended while the account has a sign-in three days
  old, but it remains the founder's call.

---

## Part 4 — Profile recreation design (Scenario A)

Production's `profiles` table, **before** the Fleet migrations, is:

| column | type | null | default |
| --- | --- | --- | --- |
| `id` | uuid | no | — (PK, FK → `auth.users` cascade) |
| `full_name`, `phone`, `avatar_url` | text | yes | — |
| `locale` | text | no | `'en'` (CHECK `en`/`he`) |
| `created_at`, `updated_at` | timestamptz | no | `now()` |

There is **no `organization_id` and no `role` column yet** — those arrive with
`20260722120000`. A pre-Fleet backfill therefore cannot and must not invent
organization membership, which is exactly what Part 4 requires.

Minimum valid row: `id` alone. Everything else defaults.

```sql
-- Must run BEFORE 20260722120000_fleet_organizations.sql.
insert into public.profiles (id, full_name)
select u.id,
       nullif(btrim(coalesce(u.raw_user_meta_data->>'full_name',
                             u.raw_user_meta_data->>'name', '')), '')
from auth.users u
left join public.profiles p on p.id = u.id
where p.id is null
  and u.deleted_at is null
on conflict (id) do nothing;
```

Generic (names no user), idempotent (`on conflict do nothing`, second run is a
no-op), and it alters no existing profile.

### It was tested locally, and it is not committed

Rebuilding the pre-Fleet schema, reproducing the orphan, running the backfill
and then all 16 Fleet migrations:

```
before backfill : profiles=1
after  backfill : profiles=2
after 2nd run   : profiles=2          (idempotent)

null organization_id remaining: vehicles=0  maintenance_logs=0
formerly-orphaned user sees   : has_org=t  role=owner  vehicles=2  logs=1
main user sees                : vehicles=1
```

The fix works and tenants stay separate. **The migration file is deliberately
not committed**: creating that profile *is* the choice of Scenario A over B and
C, and encoding a founder decision in a migration is precisely what Part 4 says
not to do. It is ready to commit the moment the decision is made.

### Verification after applying it (before the Fleet migrations)

```sql
select count(*) as users_without_profile
from auth.users u left join public.profiles p on p.id = u.id
where p.id is null and u.deleted_at is null;   -- expect 0
```

---

## Part 5 — Reassignment plan (Scenario B)

Source `e2faa5ed-…` → target `b3c52640-…`. **Preview only. Do not execute.**

Order matters: parents before children, `vehicles` first, so nothing is briefly
inconsistent.

| # | Table | Column | Rows |
| --- | --- | --- | --- |
| 1 | `vehicles` | `owner_user_id` | 3 |
| 2 | `maintenance_logs` | `owner_user_id` | 7 |
| 3 | `issue_logs` | `owner_user_id` | 4 |
| 4 | `reminders` | `owner_user_id` | 1 |
| 5 | `vehicle_documents` | `owner_user_id` | 3 |
| 6 | `document_extractions` | `owner_user_id` | 2 |
| 7 | `vehicle_passports` | `owner_user_id` | 10 |
| 8 | `transfer_tokens` | `owner_user_id` | 10 |
| 9 | `diagnosis_sessions` | `owner_user_id` | 3 |
| 10 | `diagnosis_messages` | `owner_user_id` | 6 |
| 11 | `ownership_transfers` | `from_user_id` | 1 |
| 12 | `app_events` | `user_id` | 18 |
| | | **total** | **68** |

Preview — count first, and keep the id list for rollback:

```sql
select 'vehicles' as t, id from public.vehicles where owner_user_id = '<A>'
union all select 'maintenance_logs', id from public.maintenance_logs where owner_user_id = '<A>'
union all select 'vehicle_passports', id from public.vehicle_passports where owner_user_id = '<A>'
-- … one branch per table above
order by 1;
```

Verification afterwards:

```sql
-- expect 0 on every table
select count(*) from public.vehicles where owner_user_id = '<A>';
-- expect no child row whose owner disagrees with its vehicle's owner
select c.id from public.maintenance_logs c
join public.vehicles v on v.id = c.vehicle_id
where c.owner_user_id <> v.owner_user_id;
```

Consequences to accept before choosing B:

* **Passports** move wholesale. Ten snapshots issued by Account A become
  Account B's; their frozen `snapshot.meta.issuer_user_id` still records A, so
  the historical record stays truthful while the row's owner changes.
* **Transfer tokens** move with them; any already-shared link keeps working,
  now under B's ownership. One `ownership_transfers` row records a completed
  transfer *from* A and must move too or it will cascade away with A later.
* **Storage** needs no object movement — see Part 6.
* Do **not** delete Account A in the same operation. Move, verify, then decide
  about deletion separately.

Any future reassignment must ship as a dedicated idempotent migration or an
audited repair script — not a Dashboard edit.

---

## Part 6 — Storage

One bucket, `vehicle-documents`, **private**. Three objects, all belonging to
Account A, all with `storage.objects.owner = A` and a path whose first segment
is A's uid:

```
vehicle-documents/<A-uid>/<vehicle-id>/<document-id>/<file>
```

All three `vehicle_documents` rows are Account A's (one soft-deleted).

Production's current object policies are **uid-scoped**:

```
(bucket_id = 'vehicle-documents') AND ((storage.foldername(name))[1] = auth.uid()::text)
```

* **Scenario A:** nothing to do. Paths keep matching their owner's uid, and
  signed URLs keep working before and after the release.
* **Scenario B:** the paths still start with A's uid, so under *today's*
  policies Account B could not open them. `20260725120000_document_storage_org_access`
  replaces those policies with organization-aware ones that authorize by the
  **document row's organization**, not the path — so **no object copying or path
  rewriting is ever required**, provided the reassignment happens together with
  or after that migration. Reassigning while production still runs the old
  policies would leave the files unreadable in the interim.
* **Scenario C:** deleting Account A cascades the `vehicle_documents` rows away
  and leaves 3 objects in the bucket with no metadata pointing at them —
  unreachable through the app and invisible to any cleanup that works from the
  table. They would have to be removed from Storage directly.
* Signed URLs are generated server-side after an authorization check against the
  document row, and are short-lived; none are persisted, so no existing URL
  needs reissuing under any scenario.

---

## Part 7 & 8 — Schema baseline and drift

### The baseline is exactly `20260611130000`

Production's `public` schema was compared against a locally rebuilt copy of the
repository at that version, using an order-stable catalogue fingerprint covering
tables (with RLS flags), columns (type, nullability, default), constraints,
indexes, policies (full `USING` and `WITH CHECK` expressions), functions
(`SECURITY DEFINER` flag and normalised body hash), triggers, views, and the
`storage` schema's policies.

| Object kind | Production | Expected @20260611130000 | Match |
| --- | --- | --- | --- |
| tables | 18 | 18 | = |
| columns | 237 | 237 | = |
| constraints | 100 | 100 | = |
| indexes | 66 | 66 | = |
| policies | 62 | 62 | = |
| functions | 5 | 5 | = |
| triggers | 14 | 14 | = |
| views | 4 | 4 | = |
| storage policies | 4 | 4 | = |

**All 510 catalogue objects are identical.** The diff is empty.

The boundary is *exact*, not an upper bound: compared against the previous
migration (`20260611120000`) the same fingerprint differs by 15 lines — the
`document_id` columns and foreign keys that `20260611130000` adds to
`issue_logs`, `maintenance_logs`, `vehicle_insurance`, `vehicle_registration`
and `vehicle_inspection` are present in production. So `20260611130000` is
applied, and nothing after it is.

### Drift

* **Production-only drift: none.** No extra table, column, index, constraint,
  policy, function or trigger.
* **Repository-only (missing from production): none**, within the baseline.
* **Cosmetic differences: none** beyond psql formatting echoes in the capture.
* **Material differences: none.**

One earlier false positive is worth recording so it is not rediscovered: the
`supabase db dump` output contains no `auth.users` references, which looked like
missing foreign keys. A control dump of the *local* database produced the same
absence, and the live catalogue shows all 21 constraints present. It is a
limitation of the dump command, not drift.

---

## Part 9 — Migration-history repair plan

Equivalence is proven, so the baseline **is** safe to repair. **Nothing was
executed.**

Production's `supabase_migrations.schema_migrations` reports zero rows while the
schema sits exactly at `20260611130000`. Marking the first 20 versions applied
records what the catalogue already proves; it does not skip any work.

**Safe to mark `applied` — all 20:**

```
20260607120000  20260607130000  20260607140000  20260607150000
20260607160000  20260607170000  20260607170001  20260607180000
20260607190000  20260607200000  20260607210000  20260608000000
20260608010000  20260608020000  20260608030000  20260608040000
20260608050000  20260608060000  20260611120000  20260611130000
```

Each is safe for the same reason: every object it creates or alters is present
in production with a byte-identical definition, so replaying it would be a
no-op at best and an error at worst.

**Must remain pending — all 16:** `20260722120000` through `20260726170000`.
None of their objects exist in production.

```bash
# verify BEFORE (expect: every Local row blank in the Remote column)
supabase migration list --linked

for v in 20260607120000 20260607130000 ... 20260611130000; do
  supabase migration repair --status applied "$v"
done

# verify AFTER (expect: the 20 paired, the 16 still pending)
supabase migration list --linked
supabase db push --dry-run     # must list exactly the 16 Fleet migrations
```

If a version is marked wrongly, correct it with
`supabase migration repair --status reverted <version>`. Repair only writes to
the history table — it never touches the schema — so a mistake is recoverable
without data risk, provided nothing is pushed in between.

**Do not repair until the identity decision is made and applied.** Repairing
first would leave production one `db push` away from the silent data loss the
preflight found.

---

## Part 10 — Proposed unblock sequence

1. **Founder identifies `i***@gmail.com`** and chooses Scenario A, B or C.
   If A, also decide whether the two accounts should end up in one organization
   or two.
2. Commit the corresponding corrective migration (the Scenario A design in
   Part 4 is written and locally tested; B needs the reassignment script).
3. Test it locally against a rebuilt pre-Fleet schema seeded to production's
   shape, then run the full local gate.
4. **Take a fresh production backup** immediately before the first write.
5. Apply the identity correction, alone.
6. Verify: zero Auth users without a profile; ownership counts match the
   expected map.
7. Repair the migration history for the 20 proven versions (Part 9).
8. `supabase db push --dry-run` — confirm exactly 16 migrations.
9. Apply the Fleet migrations.
10. Verify: **zero NULL `organization_id`** on every organization-scoped table,
    every organization has an owner, and both accounts can still see everything
    they owned. Run the six SQL audits.
11. Merge to `main` and deploy.
12. Smoke-test, including the physical phone-camera path.

This differs from the draft sequence in one respect: the identity correction
must be applied **before** the history repair, so that production is never left
in a state where a single `db push` would silently orphan data.

---

## Unresolved founder decisions

1. **Who is `i***@gmail.com`, and should its data stay, move, or go?**
2. If it stays: one organization for both accounts, or two?
3. Should `20260722120000` gain a defensive check that raises if any
   organization-scoped table still holds a NULL `organization_id` after the
   backfill? It would have turned this silent failure into a loud one.

## Verification gates for the future release

* `users_without_profile = 0` before any Fleet migration runs.
* `supabase db push --dry-run` lists exactly 16 migrations, none of them
  `20260607*`.
* After migration: `select count(*) where organization_id is null` returns 0 on
  `vehicles`, `maintenance_logs`, `issue_logs`, `reminders`, `vehicle_documents`,
  `document_extractions`, `vehicle_passports`, `transfer_tokens`,
  `vehicle_insurance`, `vehicle_registration`, `vehicle_inspection`.
* Every organization has exactly one owner in `organization_members`.
* Both accounts sign in and see the vehicle counts recorded in Part 2.

# Fleet Lite — driver role, assignments and Driver View

Phase 5. Adds a fifth organization role, `driver`, the assignment model that
binds a driver to exactly one vehicle, and the restricted Driver View.

Ships as two migrations that **must be applied together**:

| Migration | Contents |
| --- | --- |
| `20260725210000_driver_role_and_assignments.sql` | the role, `driver_assignments`, composite keys, helper functions |
| `20260725220000_driver_rls.sql` | every driver-aware RLS decision, the driver-safe RPCs, Storage |

Applying the first alone hands out a role the policies have not yet constrained.

---

## The leak this phase closes

The Fleet conversion (`20260722120000`) generated one identical policy for
**eleven** org-scoped tables:

```sql
using (organization_id = public.current_org_id())
```

with no role condition. That is correct for owner/admin/fleet_manager/viewer,
who are all organization-wide by design. It is catastrophic the moment a
`driver` holds a membership row, because membership alone then returns the whole
fleet.

A first pass at the driver migrations made **five** tables driver-aware and left
**six** on the bare rule. All six were live organization-wide reads for any
driver:

| # | Table | What a driver could have read |
| --- | --- | --- |
| 1 | `vehicle_insurance` | `insurer_name`, `cost` for every vehicle |
| 2 | `vehicle_inspection` | `cost`, free-text `notes` for every vehicle |
| 3 | `vehicle_registration` | free-text `notes` for every vehicle |
| 4 | `document_extractions` | `raw_text` / `extracted_data` — the OCR body of every scanned invoice |
| 5 | `vehicle_passports` | `snapshot` — the full frozen history of every vehicle, plus `snapshot_hash`, `server_signature` |
| 6 | `transfer_tokens` | `token_hash` and passport transfer state |

**Table 5 deserves emphasis.** Denying `maintenance_logs` while leaving
`vehicle_passports` organization-wide would have been security theatre: the
passport snapshot is a superset of the data the maintenance rule protects, so
every cost the first rule hid was readable through the second.

Two further defects were found in the draft's own additions, not in what it
missed:

| # | Table | Defect |
| --- | --- | --- |
| 7 | `vehicle_documents` | the draft granted drivers the whole ROW for a shared document — carrying `storage_path`, `amount`, `currency`, `vendor`, `owner_user_id`, the exact fields its own header promised drivers would never see |
| 8 | `driver_assignments` | the draft let a driver read their own assignment row, which carries `note` — a manager's free-text remark *about* that driver |

Defect 7 is the general trap: **RLS is row-level, not column-level.** A UI that
omits a column does not protect it; `select *` through PostgREST returns it
regardless.

---

## Driver data contract

A driver reads **two** tables directly. Everything else is an RPC with an
explicit column list, or nothing.

| Table | Driver access | Mechanism |
| --- | --- | --- |
| `vehicles` | the actively assigned vehicle only | row-level policy |
| `reminders` | assigned vehicle **and** `driver_visible` | row-level policy |
| `organization_members` | their own membership row | row-level policy |
| `profiles` | their own profile row | pre-existing policy |
| `maintenance_logs` | none | `get_driver_maintenance_history()` |
| `vehicle_documents` | none | `get_driver_documents()` + `get_driver_document_path()` |
| `organizations` | none | name via `get_my_driver_vehicle()` |
| `driver_assignments` | none | vehicle via `get_my_driver_vehicle()` |
| `issue_logs` | none | — (driver issue reporting is out of scope) |
| `vehicle_insurance`, `vehicle_inspection`, `vehicle_registration`, `document_extractions`, `vehicle_passports`, `transfer_tokens` | none | — |
| `organization_invitations` | none | owner/admin only |

**Exposed to a driver:** vehicle identity (make, model, year, plate, VIN,
colour, type), mileage, photo, operational status, and the operational dates
that live on the vehicle row (`next_service_date`, `next_service_km`,
`test_expiry_date`, `insurance_expiry_date`); shared reminders; service history
as date + type + mileage; shared documents as title + type + dates.

**Never exposed:** any `cost`, `currency`, `vendor`/`vendor_name`, document
`amount`, maintenance `description`, issue detail, `storage_path`,
`token_hash`, passport `snapshot`, `owner_user_id`, `organization_id`,
assignment `note`, or the member roster.

Expiry **dates** are shown; the insurance and inspection **records** behind them
are not, because those tables carry `cost`. The dates live on the vehicle row,
which is why they can be shown safely.

### Documents

Default deny, via an explicit `driver_visible` flag (default `false`) on
`vehicle_documents` and `reminders`.

Rejected alternatives: a confirmed-type allowlist (`doc_type` is free-ish text
set at upload, so a mis-typed invoice would be auto-shared, and a manager would
have no way to withhold a specific file), and allowlist-plus-override (strictly
more machinery for the same result, with the allowlist's failure mode intact).
An explicit flag is the smallest model that is default-deny and auditable.

Files open only through a server-side signed URL:
`get_driver_document_path()` re-applies the full driver rule, so a guessed id, a
document from another vehicle, or an unshared invoice on the driver's *own*
vehicle all resolve to `NULL` and no URL is signed. The path never reaches the
browser.

---

## Two bugs worth remembering

### 1. A STABLE policy function must not re-query its own table

The draft wrote the vehicles policy as `using (public.can_access_vehicle(id))`.
`can_access_vehicle()` is `STABLE` and, for a non-driver, answers by running
`select 1 from public.vehicles where id = ...`. A STABLE function sees the
snapshot from the **start of the statement**, so during `INSERT ... RETURNING`
the row being inserted is invisible to it. Postgres applies the SELECT policy to
the RETURNING clause, the predicate returned false, and the statement failed:

```
new row violates row-level security policy for table "vehicles"
```

The INSERT itself was fine — a bare insert succeeded and the row was created.
Only the read-back failed, which is what every `.insert(...).select().single()`
in the app does. Caught by the Fleet tenancy, document Storage and
organization-members harnesses, all of which create a vehicle that way.

The policy now compares `organization_id` on the row under evaluation. The
harness asserts `INSERT ... RETURNING` explicitly so this cannot regress.

### 2. Revoking a policy helper from `anon` breaks anonymous reads

`is_org_driver()`, `current_driver_vehicle_id()`, `can_access_vehicle()` and
`can_manage_driver_assignments()` appear inside policy expressions on tables
`anon` holds a table grant for. Postgres checks EXECUTE when the policy is
planned, so revoking the grant does not deny the anonymous caller — it makes the
query **raise** instead of returning zero rows. Verified directly:

```sql
revoke execute on function public.can_manage_driver_assignments() from anon;
set local role anon; select count(*) from public.driver_assignments;
-- ERROR: permission denied for function can_manage_driver_assignments
```

The grant is safe because every one of these is driven by `auth.uid()`, which is
`NULL` for anon. Audit check 5b asserts exactly that. Driver functions that
return **data** are authenticated-only.

---

## Roles

`driver` is **not** a narrower `viewer`. A viewer reads the whole organization;
a driver reads one assigned vehicle. They are separate roles with separate rules.

| | owner | admin | fleet_manager | viewer | driver |
| --- | --- | --- | --- | --- | --- |
| read fleet data | ✅ | ✅ | ✅ | ✅ | assigned vehicle only |
| write fleet data | ✅ | ✅ | ✅ | ❌ | ❌ |
| organization settings | ✅ | ✅ | ❌ | ❌ | ❌ |
| manage members / invitations | ✅ | ✅ | ❌ | ❌ | ❌ |
| assign drivers | ✅ | ✅ | ✅ | ❌ | ❌ |

Assignment rights and membership rights are deliberately separate: a
fleet_manager may hand a vehicle to a driver but may not invite or remove
members.

`driver` is invitable; `owner` remains un-invitable (ownership is granted by
promoting an existing member). Acceptance creates **membership, not assignment** —
a newly accepted driver has no vehicle until a manager assigns one.

`vehicles.assigned_driver_name` / `assigned_driver_phone` remain free text and
grant **no** authorization. Users are never matched to them; only the
`driver_user_id` on an active assignment authorizes.

---

## Assignment model

One active driver per vehicle, one active vehicle per driver — enforced by
partial unique indexes on `unassigned_at is null`, not by application logic.
Multi-driver shifts and rotations are out of scope. Ended assignments are
retained as history and grant nothing.

`assign_driver()` closes the vehicle's current assignment **and** the incoming
driver's current assignment before inserting, all in one transaction, so a
reassignment never transiently produces two active drivers. There is no separate
"replace" call: assigning *is* the replace. `unassign_driver()` is idempotent.

Access survives none of these: membership removal, role change, unassignment, a
stale active assignment row, or a soft-deleted vehicle.
`current_driver_vehicle_id()` re-joins `organization_members`, re-checks the
`driver` role and joins `vehicles` for `deleted_at is null`, so a historical row
belonging to someone whose membership is gone resolves to nothing.

---

## Verification

```bash
supabase db reset
docker exec -i supabase_db_vin-id psql -U postgres -d postgres \
  -f - < supabase/audits/driver_rls_audit.sql        # 10 checks, all 0 rows

FLEET_CHECK_ALLOW=1 SUPABASE_URL=http://127.0.0.1:54321 \
SUPABASE_ANON_KEY=<local> SUPABASE_SERVICE_ROLE_KEY=<local> \
  npm run validate:driver-view                        # 116 assertions
```

`supabase/audits/driver_rls_audit.sql` inspects **effective policy expressions**,
never policy names, and derives the org-scoped table list from the **catalog** —
so a new table carrying `organization_id` is flagged the day it is created,
before anyone remembers to think about drivers. That is the check that would
have caught the original six. Verified against a negative control: reintroducing
the leak on four tables, including one named `driver_safe_inspection_policy`,
flagged all four.

`scripts/validation/driver-view-check.mjs` derives the same list from PostgREST's
OpenAPI document and asserts the coverage matrix matches it, then proves the
expected access for each table with real signed-in sessions across ten personas:
owner, admin, fleet_manager, viewer, Driver A, Driver B, an unassigned driver, a
removed driver with a stale active assignment, an Org B driver, and anonymous.
The service role is used only to build fixtures.

Regression suites, all passing: fleet tenancy (51), document Storage (25),
organization members and invitations (77), Fleet Manager (50), Driver View (116).

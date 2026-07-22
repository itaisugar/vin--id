# Vin.ID Fleet Lite — Phase 1: Fleet Foundation

Multi-tenant organization foundation, fleet vehicle fields, Fleet Dashboard,
fleet vehicles list and fleet vehicle page.

---

## Migrations to run (Supabase SQL Editor, in order)

| # | File | What it does |
|---|------|--------------|
| 1 | `supabase/migrations/20260722120000_fleet_organizations.sql` | organizations table, profiles.organization_id + role, `organization_id` on 11 tables, backfill, RLS rewrite, signup trigger |
| 2 | `supabase/migrations/20260722130000_fleet_vehicle_fields.sql` | `operational_status` + fleet vehicle columns + dashboard indexes |

Then run the audit and confirm every detection query returns **zero rows**:

```
supabase/audits/fleet_tenancy_audit.sql
```

Both migrations are **non-destructive and idempotent**: no table is dropped or
recreated, no row is deleted, no id is regenerated, and no passport token is
touched. Existing share URLs keep working because `transfer_tokens.token_hash`
is never modified.

---

## Security model

### How the organization is resolved

Always from the authenticated user's profile, server-side:

```
auth.uid() -> profiles.organization_id
```

There is **no code path** that accepts an organization id from a form, query
string, header or any other client input. `lib/organizations/service.ts` is the
only place that resolves it, and it throws rather than falling back:

- not signed in -> `NotAuthenticatedError`
- signed in, no organization -> `OrganizationMissingError`

Silently defaulting to "some" organization would be a cross-tenant leak, so
"no organization" is a hard error that renders a dedicated message.

### Three layers of defense

1. **RLS** — every fleet table:
   - read: `organization_id = public.current_org_id()`
   - write: `organization_id = public.current_org_id() AND public.is_org_writer()`
2. **Explicit server filters** — every query in `lib/*/service.ts` also adds
   `.eq("organization_id", …)`. An RLS regression cannot silently widen a query.
3. **Action guards** — `requireFleetWriter()` / `requireOrganizationRole()`
   before mutations, so a viewer gets a clear error instead of an opaque denial.

### Why `organization_id` cannot be forged

A `BEFORE INSERT` trigger (`set_organization_id_from_owner`) derives
`organization_id` from the row's `owner_user_id` whenever it is NULL. Postgres
fires BEFORE ROW triggers *before* evaluating the RLS `WITH CHECK` clause, so
the derived value is what gets policy-checked.

This is also what made the migration non-invasive: **every existing insert path
keeps working untouched**, including the 200-line SECURITY DEFINER
`accept_passport()` RPC, which inserts rows with `owner_user_id = v_buyer`.
No RPC needed rewriting.

### Roles

| Role | Fleet data | Organization settings |
|------|-----------|----------------------|
| `owner` | read + write | yes |
| `admin` | read + write | yes |
| `fleet_manager` | read + write | no |
| `viewer` | read only | no |

Enforced in SQL by `public.is_org_writer()` and in TypeScript by
`canWriteFleetData()` / `canManageOrganization()`. The UI hides controls a
viewer cannot use, but that is only an affordance — the server action and RLS
each enforce it independently.

### Public Passport is unchanged

`/p/[token]` still goes through the existing `get_public_passport` SECURITY
DEFINER RPC and reads `snapshot_json` only. The snapshot serializes an explicit
field list (`lib/passports/service.ts`), which does **not** include
`organization_id`, `assigned_driver_phone` or `operational_status` — so the
fleet migration adds no new public exposure. `anon` still has no table
privileges anywhere.

---

## Two status axes (important)

These are deliberately **separate columns**. Collapsing them would break
archiving and the passport ownership-transfer flow.

| Column | Values | Meaning |
|--------|--------|---------|
| `vehicles.status` | `active` / `archived` / `sold` | Lifecycle. Pre-existing. `accept_passport` sets the seller's vehicle to `sold`. |
| `vehicles.operational_status` | `active` / `needs_service` / `issue_open` / `out_of_service` / `in_garage` / `documents_missing` | **New.** "Can this vehicle work today?" |

The fleet dashboard and list only consider lifecycle-`active` vehicles — archived
and sold vehicles are history, not fleet.

---

## Migration assumptions

1. **One personal organization per existing profile** (not one shared legacy
   org). Each existing user becomes `owner` of their own organization, so the
   current isolation between consumer users is preserved exactly. No user gained
   visibility of another user's data.

2. **`owner_user_id` is kept** on every table, still `NOT NULL`, now carrying
   "created by / original owner" semantics. Nothing reads it for authorization.

3. **`current_km` is `current_mileage`.** The spec lists `current_km`, but the
   table already has `current_mileage` plus a per-vehicle `mileage_unit`, which
   the mileage bump, passport snapshot and scan flow all depend on. Adding a
   second column would create two sources of truth. The UI labels it "Current KM"
   and renders the vehicle's own unit.

4. **Expiry dates are plain columns for now.** `test_expiry_date`,
   `insurance_expiry_date` and `next_service_*` are manually entered. The agreed
   end state is that they become caches refreshed from `vehicle_documents.expiry_date`
   by a trigger — that belongs to the documents phase, which is out of scope here.
   The columns are shaped so that change is purely additive.

5. **`next_service_km` below current mileage is allowed.** It means the service
   is overdue, which is a first-class fleet state the dashboard reports on.
   Rejecting it would make an overdue service impossible to record. The UI shows
   "Overdue" rather than a validation error.

6. **Existing vehicles default to `operational_status = 'active'`.** No existing
   data distinguishes an operational state, so inferring one would be fabricating
   fleet status.

7. **Tables NOT converted to org scoping** (still owner-scoped):
   `diagnosis_sessions`, `diagnosis_messages`, `audit_logs`, `beta_feedback`,
   `app_events`, `ownership_transfers`, `profiles`. Diagnosis is personal and
   out of scope; audit/analytics rows are per-user by design;
   `ownership_transfers` is cross-org by nature and has no `owner_user_id`.

---

## Demo / development data

The project has **no seed mechanism**, and this phase deliberately does not
introduce one — a seeder that can reach production is a bigger risk than the
convenience is worth.

To create demo data manually, sign up a fresh account (which provisions its own
organization) and add vehicles through `/vehicles/new`. Suggested mix for a
realistic 10-vehicle fleet:

| Plate | Vehicle | Type | Operational status | Notes |
|-------|---------|------|--------------------|-------|
| 12-345-67 | Toyota Hilux | Pickup | `active` | test + insurance ~6 months out |
| 23-456-78 | Ford Transit | Van | `needs_service` | next service date in the past |
| 34-567-89 | Renault Master | Van | `issue_open` | add an open issue |
| 45-678-90 | Hyundai i20 | Car | `active` | |
| 56-789-01 | Isuzu D-Max | Pickup | `in_garage` | |
| 67-890-12 | Mercedes Sprinter | Van | `out_of_service` | |
| 78-901-23 | Skoda Octavia | Car | `documents_missing` | leave test/insurance empty |
| 89-012-34 | Peugeot Partner | Van | `active` | insurance expiring within 30 days |
| 90-123-45 | Kia Picanto | Car | `active` | |
| 01-234-56 | Volvo FL | Truck | `needs_service` | next service KM below current KM |

Set a few dates inside the next 30 days and a few in the past — that is what
makes "Vehicles requiring attention" and "Upcoming maintenance & documents"
show real content.

---

## Known limitations

- **Documents uploaded by one user are not viewable by another user in the same
  organization.** Storage paths are `{user_id}/{vehicle_id}/{document_id}/…` and
  the `vehicle-documents` bucket policy keys on the first path segment =
  `auth.uid()`. The metadata row is now org-visible, but `getDocumentSignedUrl`
  will return null for a colleague's file. Not reachable today (no invitations,
  so every organization has exactly one user), but it **must** be fixed before
  multi-user organizations ship — it needs an org-keyed storage path or an
  org-aware storage policy.
- No invitations, no team management, no multi-org membership — a user belongs
  to exactly one organization, created at signup.
- No organization settings UI. The `organizations` row exists and is editable via
  RLS by owner/admin, but nothing renders a form for it yet.
- Roles cannot be changed from the UI (no user-management screen). Every new
  signup is `owner` of their own organization; other roles must be set in SQL.
- The vehicle event timeline is a labelled placeholder — no events are recorded
  and no fabricated data is shown.
- Documents/issues/maintenance keep their existing vocabularies. The 9-state
  issue workflow, `operational_impact`, work orders and costs are later phases.
- The dashboard's "documents to handle" counts vehicles, not documents.

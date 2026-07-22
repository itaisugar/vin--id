-- =============================================================================
-- Vin.ID Fleet Lite — Phase 1: fleet-specific vehicle fields
-- =============================================================================
-- Adds the operational fields a fleet manager needs on top of the existing
-- consumer vehicle record.
--
-- IMPORTANT — two different status axes:
--
--   vehicles.status              LIFECYCLE  : active | archived | sold
--                                Already exists. Drives archiving and the
--                                Passport ownership-transfer flow (accept_passport
--                                sets the seller's vehicle to 'sold'). UNTOUCHED.
--
--   vehicles.operational_status  OPERATIONAL: active | needs_service | issue_open |
--                                out_of_service | in_garage | documents_missing
--                                NEW. "Can this vehicle work today?"
--
-- Collapsing these into one column would break archive/sold and the passport
-- transfer flow, so they are deliberately kept separate.
--
-- ASSUMPTION — current_km: the spec lists `current_km`, but the table already
-- has `current_mileage` (integer, >= 0) plus a per-vehicle `mileage_unit`
-- (km | miles) that the whole app, the upward-only mileage bump, the Passport
-- snapshot and the scan flow all depend on. Adding a second column would create
-- two sources of truth for one number, so `current_mileage` IS the fleet's
-- current KM and no new column is added. The fleet UI labels it "Current KM"
-- and renders the vehicle's own unit.
--
-- ASSUMPTION — expiry dates: `test_expiry_date` / `insurance_expiry_date` /
-- `next_service_*` are plain, manually-entered columns in this phase. The agreed
-- end-state is that they become denormalized caches refreshed from
-- vehicle_documents.expiry_date by a trigger — that arrives with the documents
-- phase, which is explicitly out of scope here. Columns are shaped now so the
-- later trigger is additive and needs no second migration of the vehicles table.
--
-- NON-DESTRUCTIVE: additive columns only. No existing column is renamed,
-- retyped or dropped. Idempotent.
-- =============================================================================

alter table public.vehicles
  add column if not exists operational_status      text not null default 'active',
  add column if not exists vehicle_type            text,
  add column if not exists assigned_driver_name    text,
  add column if not exists assigned_driver_phone   text,
  add column if not exists next_service_date       date,
  add column if not exists next_service_km         integer,
  add column if not exists test_expiry_date        date,
  add column if not exists insurance_expiry_date   date;

-- Constrained text (project convention — no Postgres enums anywhere in this
-- schema). TypeScript/Zod validates the same vocabulary on the way in.
alter table public.vehicles drop constraint if exists vehicles_operational_status_check;
alter table public.vehicles
  add constraint vehicles_operational_status_check
  check (operational_status in (
    'active',
    'needs_service',
    'issue_open',
    'out_of_service',
    'in_garage',
    'documents_missing'
  ));

-- Mileage-style guard, matching the existing current_mileage constraint.
alter table public.vehicles drop constraint if exists vehicles_next_service_km_check;
alter table public.vehicles
  add constraint vehicles_next_service_km_check
  check (next_service_km is null or next_service_km >= 0);

-- Existing rows default to 'active' (set by the column default above). No data
-- currently distinguishes an operational state, so inventing one would be
-- fabricating fleet status — 'active' is the honest starting point and the
-- fleet manager sets the real value from the vehicle page.

-- Dashboard/list access paths: "vehicles needing attention" and "closest
-- deadline" queries filter by org then by status/date.
create index if not exists vehicles_org_operational_status_idx
  on public.vehicles (organization_id, operational_status);

create index if not exists vehicles_org_next_service_date_idx
  on public.vehicles (organization_id, next_service_date)
  where next_service_date is not null;

create index if not exists vehicles_org_test_expiry_idx
  on public.vehicles (organization_id, test_expiry_date)
  where test_expiry_date is not null;

create index if not exists vehicles_org_insurance_expiry_idx
  on public.vehicles (organization_id, insurance_expiry_date)
  where insurance_expiry_date is not null;

-- =============================================================================
-- End of migration
-- =============================================================================

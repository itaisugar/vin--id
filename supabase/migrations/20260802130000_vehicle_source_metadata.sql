-- =============================================================================
-- Vin.ID — vehicle source metadata + fuel type (government lookup MVP)
-- =============================================================================
-- Supports the Israeli government vehicle-lookup flow (Task D). A user may
-- pre-fill Add Vehicle from the official Ministry of Transport dataset, edit
-- every field, then confirm. When they do, we record WHERE the initial data came
-- from and WHEN — so the vehicle page and Passport can show provenance honestly.
--
-- Additive only. No column is renamed, retyped or dropped; every new column is
-- nullable so all existing rows remain valid with no backfill. No RLS change:
-- vehicles are already organization-scoped, and these columns ride on the
-- existing row policies.
--
-- WHAT THIS IS NOT. `data_source = 'israel_government'` records provenance, NOT
-- verification. It is not proof of current ownership or physical condition, and
-- it is deliberately never called 'verified'. The user's confirmed, editable
-- values are the source of truth; the government value was only a proposal.
--
-- Idempotent.
-- =============================================================================

alter table public.vehicles
  -- Fuel type (e.g. בנזין / חשמל). Absent until now; useful for the record and
  -- future maintenance/compliance context. User-editable.
  add column if not exists fuel_type text,
  -- Provenance of the vehicle's INITIAL data. NULL for every existing row and
  -- for plain manual entry; 'israel_government' when pre-filled from the official
  -- lookup and then confirmed. Never trusted from the client beyond this
  -- allowlist (the server sets it).
  add column if not exists data_source text,
  -- When the official lookup was performed (server-set, ISO). NULL for manual.
  add column if not exists government_fetched_at timestamptz,
  -- Which DataStore resource answered (server-set from configuration, never from
  -- the client). Kept so a later resource swap is auditable per row.
  add column if not exists government_resource_id text;

-- Constrained vocabulary (project convention — no enums). NULL stays valid for
-- existing rows and for manual creation that does not bother to set it.
alter table public.vehicles drop constraint if exists vehicles_data_source_check;
alter table public.vehicles
  add constraint vehicles_data_source_check
  check (data_source is null or data_source in ('manual', 'israel_government'));

comment on column public.vehicles.data_source is
  'Provenance of the initial vehicle data: NULL/manual = user-entered; israel_government = pre-filled from data.gov.il and then user-confirmed. Provenance only — NOT ownership or verification. The confirmed row values are authoritative.';
comment on column public.vehicles.government_resource_id is
  'The data.gov.il DataStore resource id that answered the lookup (server-set from config). For per-row audit if the configured resource changes.';

-- =============================================================================
-- End of migration
-- =============================================================================

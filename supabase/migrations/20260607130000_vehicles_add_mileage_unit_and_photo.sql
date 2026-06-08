-- =============================================================================
-- Vin.ID — Phase 2B: vehicles — add mileage_unit + photo_url
-- =============================================================================
-- Additive, non-destructive change required by the Vehicle CRUD form, which
-- captures a mileage unit (km/miles) and an optional photo URL. The base
-- schema (20260607120000_init_core_schema.sql) already stores mileage in
-- `current_mileage`; this only adds the two missing columns.
--
-- Safe to run on the existing database (uses IF NOT EXISTS).
-- =============================================================================

alter table public.vehicles
  add column if not exists mileage_unit text not null default 'km'
    check (mileage_unit in ('km', 'miles'));

alter table public.vehicles
  add column if not exists photo_url text;

-- =============================================================================
-- Vin.ID — Phase 4B: document_extractions — review lifecycle
-- =============================================================================
-- MOCK document extraction is never auto-applied: it is saved as a pending
-- extraction the user must review and confirm. This migration aligns the
-- status vocabulary to that lifecycle and adds the confirmed payload.
--
--   * status: pending_confirmation | confirmed | discarded | failed
--             (default pending_confirmation)
--   * confirmed_data jsonb  — the fields the user confirmed (set on confirm)
--   * confirmed_at  timestamptz
--
-- `extracted_data` (already present) holds the structured mock extraction.
-- Safe to run on the existing database: document_extractions has no rows yet.
-- =============================================================================

alter table public.document_extractions
  alter column status set default 'pending_confirmation';

alter table public.document_extractions
  drop constraint if exists document_extractions_status_check;

alter table public.document_extractions
  add constraint document_extractions_status_check
  check (status in ('pending_confirmation', 'confirmed', 'discarded', 'failed'));

alter table public.document_extractions
  add column if not exists confirmed_data jsonb;

alter table public.document_extractions
  add column if not exists confirmed_at timestamptz;

-- =============================================================================
-- Vin.ID — Phase 2C: maintenance_logs — trust vocabulary + source_type
-- =============================================================================
-- The Phase 2A base schema gave maintenance_logs a trust_label CHECK limited to
-- ('self_reported','document_backed','shop_verified') and had no source_type
-- column. Phase 2C defines the product's actual trust model and a record source,
-- which the base schema cannot store. This migration aligns maintenance_logs:
--
--   * adds `source_type` (default 'user')
--   * widens `trust_label` to the product trust vocabulary and changes the
--     default to 'user_entered'
--
-- Trust values:
--   user_entered | document_backed | ai_extracted | mechanic_verified | external_source
--
-- Safe to run on the existing database: maintenance_logs has no rows yet, so the
-- new CHECK constraint validates cleanly. Idempotent guards are used where
-- possible.
-- =============================================================================

-- 1. Record source (how the row entered the system). Future: imports, AI, etc.
alter table public.maintenance_logs
  add column if not exists source_type text not null default 'user';

-- 2. Switch the default to the new vocabulary before swapping the constraint.
alter table public.maintenance_logs
  alter column trust_label set default 'user_entered';

-- 3. Replace the trust_label CHECK with the product trust vocabulary.
alter table public.maintenance_logs
  drop constraint if exists maintenance_logs_trust_label_check;

alter table public.maintenance_logs
  add constraint maintenance_logs_trust_label_check
  check (
    trust_label in (
      'user_entered',
      'document_backed',
      'ai_extracted',
      'mechanic_verified',
      'external_source'
    )
  );

-- =============================================================================
-- Vin.ID — Phase 2D: issue_logs — severity vocabulary, resolution, trust, source
-- =============================================================================
-- The Phase 2A base schema gave issue_logs a severity CHECK of
-- ('low','medium','high','critical'), a trust_label limited to the old
-- 3-value set, and no resolution_notes / source_type columns. Phase 2D defines
-- the product's actual issue severity model, a resolution note, the shared
-- trust vocabulary, and a record source. This migration aligns issue_logs:
--
--   * adds `resolution_notes`
--   * adds `source_type` (default 'user')
--   * widens `trust_label` to the product trust vocabulary (default 'user_entered')
--   * replaces `severity` with the product severity vocabulary (default 'monitor')
--
-- Severity values:
--   info | monitor | diy_simple | mechanic_recommended | urgent | stop_immediately
-- Trust values:
--   user_entered | document_backed | ai_extracted | mechanic_verified | external_source
--
-- Status is unchanged (open | monitoring | resolved) — it already matches.
--
-- Safe to run on the existing database: issue_logs has no rows yet, so the new
-- CHECK constraints validate cleanly.
-- =============================================================================

-- 1. Resolution note (free text, set when an issue is resolved).
alter table public.issue_logs
  add column if not exists resolution_notes text;

-- 2. Record source (how the row entered the system).
alter table public.issue_logs
  add column if not exists source_type text not null default 'user';

-- 3. Trust vocabulary (matches maintenance_logs).
alter table public.issue_logs
  alter column trust_label set default 'user_entered';

alter table public.issue_logs
  drop constraint if exists issue_logs_trust_label_check;

alter table public.issue_logs
  add constraint issue_logs_trust_label_check
  check (
    trust_label in (
      'user_entered',
      'document_backed',
      'ai_extracted',
      'mechanic_verified',
      'external_source'
    )
  );

-- 4. Severity vocabulary.
alter table public.issue_logs
  alter column severity set default 'monitor';

alter table public.issue_logs
  drop constraint if exists issue_logs_severity_check;

alter table public.issue_logs
  add constraint issue_logs_severity_check
  check (
    severity in (
      'info',
      'monitor',
      'diy_simple',
      'mechanic_recommended',
      'urgent',
      'stop_immediately'
    )
  );

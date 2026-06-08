-- =============================================================================
-- Vin.ID — Phase 4A: issue_logs — link to a diagnosis session
-- =============================================================================
-- "Save as issue" from a MOCK_AI diagnosis records which diagnosis session the
-- issue came from. Adds a nullable FK; on session delete the link is cleared
-- (the issue itself is kept). source_type='mock_ai_diagnosis' marks the origin
-- (source_type is free text — no CHECK — so no further change is needed).
--
-- Safe to run on the existing database (additive, IF NOT EXISTS).
-- =============================================================================

alter table public.issue_logs
  add column if not exists diagnosis_session_id uuid
    references public.diagnosis_sessions(id) on delete set null;

create index if not exists issue_logs_diagnosis_session_id_idx
  on public.issue_logs (diagnosis_session_id);

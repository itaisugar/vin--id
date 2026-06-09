-- =============================================================================
-- Vin.ID — Phase 6G-lite: allow beta_feedback.type = 'deletion_request'
-- =============================================================================
-- The "Account deletion" control in Settings records a deletion *request* as a
-- beta_feedback row (no automated deletion in beta). This widens the type CHECK
-- to allow that value. Insert-only RLS is unchanged (users submit, the team
-- reviews in the console).
--
-- Safe/additive + idempotent. Run in the Supabase SQL Editor.
-- =============================================================================

alter table public.beta_feedback
  drop constraint if exists beta_feedback_type_check;

alter table public.beta_feedback
  add constraint beta_feedback_type_check
  check (type in ('bug', 'idea', 'confusing', 'other', 'deletion_request'));

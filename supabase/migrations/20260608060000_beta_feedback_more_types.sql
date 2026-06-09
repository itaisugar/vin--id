-- =============================================================================
-- Vin.ID — Phase 6J-lite: more beta_feedback types
-- =============================================================================
-- The beta tester pack adds two feedback types selectable in Settings:
--   * 'trust_privacy'    — trust / privacy concern
--   * 'beta_test_result' — result of running the beta test script
-- 'deletion_request' (added in 6G) is kept. Insert-only RLS is unchanged.
--
-- Safe/additive + idempotent. Run in the Supabase SQL Editor.
-- =============================================================================

alter table public.beta_feedback
  drop constraint if exists beta_feedback_type_check;

alter table public.beta_feedback
  add constraint beta_feedback_type_check
  check (type in (
    'bug', 'idea', 'confusing', 'trust_privacy', 'beta_test_result',
    'other', 'deletion_request'
  ));

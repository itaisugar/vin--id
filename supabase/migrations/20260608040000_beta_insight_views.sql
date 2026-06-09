-- =============================================================================
-- Vin.ID — Phase 6F-lite: beta insight views (owner/manual inspection only)
-- =============================================================================
-- Lightweight aggregate views over `app_events` so the project owner can read
-- MVP usage in the Supabase SQL Editor / Table Editor. There is NO admin UI and
-- NO app-facing access — these are for manual inspection by the Supabase owner.
--
-- Privacy / safety:
--   * Views aggregate ONLY (counts per day / totals). They never select raw
--     metadata values, so no sensitive content can leak through them.
--   * Each view uses `security_invoker = true` so it runs with the *querying*
--     role's privileges (not the definer's). Combined with app_events' RLS
--     (no select policy) this means anon/authenticated cannot read through them.
--   * SELECT is additionally REVOKED from anon + authenticated as defense in
--     depth, so the views are not exposed via the PostgREST API.
--   * No SECURITY DEFINER is used (avoids the Supabase "definer view" lint).
--
-- Safe/additive + idempotent (create or replace). Run in the Supabase SQL Editor.
-- =============================================================================

-- Per-day count of every event type.
create or replace view public.beta_event_counts_daily
with (security_invoker = true) as
select
  (created_at at time zone 'UTC')::date as event_date,
  event_name,
  count(*)::bigint                       as event_count
from public.app_events
group by 1, 2;

-- Core daily funnel (one row per day, columns per stage).
create or replace view public.beta_core_funnel_daily
with (security_invoker = true) as
select
  (created_at at time zone 'UTC')::date as event_date,
  count(*) filter (where event_name = 'vehicle_created')                  as vehicles_created,
  count(*) filter (where event_name = 'document_uploaded')                as documents_uploaded,
  count(*) filter (where event_name = 'passport_created')                 as passports_created,
  count(*) filter (where event_name = 'passport_public_preview_opened')   as public_previews_opened,
  count(*) filter (where event_name = 'passport_accepted')                as passports_accepted,
  count(*) filter (where event_name = 'beta_feedback_submitted')          as feedback_submitted
from public.app_events
group by 1;

-- Passport funnel totals + acceptance rate (accepted / created).
create or replace view public.beta_passport_funnel_summary
with (security_invoker = true) as
select
  count(*) filter (where event_name = 'passport_created')               as passports_created,
  count(*) filter (where event_name = 'passport_public_preview_opened') as public_previews_opened,
  count(*) filter (where event_name = 'passport_accepted')              as passports_accepted,
  round(
    count(*) filter (where event_name = 'passport_accepted')::numeric
      / nullif(count(*) filter (where event_name = 'passport_created'), 0),
    4
  )                                                                      as acceptance_rate
from public.app_events;

-- Mock-AI usage totals.
create or replace view public.beta_mock_ai_usage_summary
with (security_invoker = true) as
select
  count(*) filter (where event_name = 'mock_diagnosis_completed')             as mock_diagnosis_completed,
  count(*) filter (where event_name = 'mock_diagnosis_saved_as_issue')        as mock_diagnosis_saved_as_issue,
  count(*) filter (where event_name = 'mock_document_extraction_started')     as mock_document_extraction_started,
  count(*) filter (where event_name = 'mock_document_extraction_confirmed')   as mock_document_extraction_confirmed
from public.app_events;

-- Keep these owner/manual-inspection only — never exposed through the app API.
revoke all on public.beta_event_counts_daily        from anon, authenticated;
revoke all on public.beta_core_funnel_daily          from anon, authenticated;
revoke all on public.beta_passport_funnel_summary    from anon, authenticated;
revoke all on public.beta_mock_ai_usage_summary      from anon, authenticated;

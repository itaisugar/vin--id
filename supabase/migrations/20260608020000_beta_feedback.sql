-- =============================================================================
-- Vin.ID — Phase 5C: beta_feedback (in-app beta feedback)
-- =============================================================================
-- Stores beta feedback submitted from Settings. Insert-only for users: they can
-- submit their own feedback but cannot read others' (or their own) back. There
-- is no email sending and no external tool — just a row in Supabase.
--
-- Safe/additive. Run in the Supabase SQL Editor.
-- =============================================================================

create table if not exists public.beta_feedback (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references auth.users(id) on delete set null,
  email       text,
  type        text not null default 'other'
                check (type in ('bug', 'idea', 'confusing', 'other')),
  message     text not null,
  page_url    text,
  user_agent  text,
  status      text not null default 'new'
                check (status in ('new', 'reviewed', 'closed')),
  created_at  timestamptz not null default now()
);

create index if not exists beta_feedback_created_at_idx
  on public.beta_feedback (created_at desc);

alter table public.beta_feedback enable row level security;

-- Authenticated users may INSERT their own feedback. No select/update/delete
-- policies — users cannot read feedback back (reviewed in the Supabase console).
drop policy if exists "beta_feedback_insert_own" on public.beta_feedback;
create policy "beta_feedback_insert_own" on public.beta_feedback
  for insert to authenticated
  with check (user_id = (select auth.uid()));

grant insert on public.beta_feedback to authenticated;

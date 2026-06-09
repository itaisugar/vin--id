-- =============================================================================
-- Vin.ID — Phase 6E-lite: app_events (privacy-safe beta product analytics)
-- =============================================================================
-- Minimal, first-party product event log so we can understand whether beta
-- users complete the core Vin.ID loop. NO third-party analytics, NO external
-- SDK — just rows in Supabase, inspected in the Table Editor.
--
-- Privacy model:
--   * Payloads are small and non-sensitive (counts, booleans, enums, source).
--   * NEVER store document text, issue symptoms, diagnosis text, VIN, license
--     plate, storage paths, raw Passport tokens, or token hashes.
--   * Authenticated users may INSERT only their own events (user_id = auth.uid()).
--   * There is NO select/update/delete policy — users cannot read events back.
--   * Anonymous public-preview events are inserted ONLY through the SECURITY
--     DEFINER function below (which validates the token), never via a broad
--     anon insert policy.
--
-- Safe/additive. Run in the Supabase SQL Editor.
-- =============================================================================

create table if not exists public.app_events (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid references auth.users(id) on delete set null,
  anonymous_id text,
  event_name   text not null,
  entity_type  text,
  entity_id    uuid,
  vehicle_id   uuid,
  passport_id  uuid,
  metadata     jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now()
);

create index if not exists app_events_created_at_idx
  on public.app_events (created_at desc);
create index if not exists app_events_event_name_idx
  on public.app_events (event_name);
create index if not exists app_events_user_id_idx
  on public.app_events (user_id);

alter table public.app_events enable row level security;

-- Authenticated users may INSERT their own events only. No select/update/delete
-- policies — events are reviewed in the Supabase console, never read by the app.
drop policy if exists "app_events_insert_own" on public.app_events;
create policy "app_events_insert_own" on public.app_events
  for insert to authenticated
  with check (user_id = (select auth.uid()));

grant insert on public.app_events to authenticated;

-- ---------------------------------------------------------------------------
-- Public Passport preview event (anonymous-safe).
-- ---------------------------------------------------------------------------
-- The public preview at /p/[token] may be opened by an anonymous visitor, who
-- has no INSERT policy on app_events. Rather than open a broad anon insert
-- policy, this SECURITY DEFINER function validates the token the same way the
-- public preview RPC does and logs ONE specific, curated event. It never stores
-- the raw token or the token hash — only the validated passport_id.
create or replace function public.log_passport_preview(p_token_hash text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token    public.transfer_tokens%rowtype;
  v_passport public.vehicle_passports%rowtype;
begin
  -- Only log for a genuinely viewable passport (mirrors get_public_passport).
  select * into v_token
  from public.transfer_tokens
  where token_hash = p_token_hash;
  if not found then return; end if;
  if v_token.status <> 'active' then return; end if;
  if v_token.expires_at is not null and v_token.expires_at < now() then
    return;
  end if;

  select * into v_passport
  from public.vehicle_passports
  where id = v_token.passport_id
    and deleted_at is null;
  if not found then return; end if;
  if v_passport.status <> 'active' then return; end if;

  insert into public.app_events (
    user_id, event_name, entity_type, entity_id, passport_id, metadata
  )
  values (
    auth.uid(),                       -- null for anonymous viewers
    'passport_public_preview_opened',
    'passport',
    v_passport.id,
    v_passport.id,
    jsonb_build_object('source', 'public_preview')
  );
exception
  when others then
    -- Tracking must never break the preview.
    return;
end;
$$;

revoke all on function public.log_passport_preview(text) from public;
grant execute on function public.log_passport_preview(text) to anon, authenticated;

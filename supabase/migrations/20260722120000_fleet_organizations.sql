-- =============================================================================
-- Vin.ID Fleet Lite — Phase 1: organizations + multi-tenant foundation
-- =============================================================================
-- Converts Vin.ID from a SINGLE-OWNER app (every table scoped by
-- `owner_user_id = auth.uid()`) into a MULTI-TENANT fleet app scoped by
-- `organization_id`.
--
-- Design decisions (documented assumptions — see docs/fleet-lite-phase-1.md):
--
--  1. `owner_user_id` is KEPT on every table and keeps its NOT NULL constraint.
--     It now carries "created_by / original owner" semantics. Nothing reads it
--     for authorization any more, but keeping it means:
--       * no existing INSERT path in the app or in accept_passport() breaks,
--       * the column can back a future `created_by` UI without another backfill.
--
--  2. `organization_id` is auto-derived by a BEFORE INSERT trigger from the
--     inserting row's `owner_user_id` -> `profiles.organization_id`. This is
--     what makes the migration non-invasive: every existing insert (server
--     actions, services, AND the 200-line SECURITY DEFINER accept_passport()
--     RPC) keeps working untouched, and the client can never choose its own
--     organization_id. Postgres fires BEFORE ROW triggers before evaluating the
--     RLS WITH CHECK clause, so the derived value is what gets policy-checked.
--
--  3. One user belongs to exactly ONE organization (profiles.organization_id).
--     Multi-org membership, invitations and team management are out of scope.
--
--  4. Backfill creates ONE personal organization PER EXISTING PROFILE (not one
--     shared legacy org). Consumer users keep their data fully isolated from
--     each other, which preserves the current security posture exactly. Each
--     backfilled user becomes `owner` of their own organization.
--
--  5. RLS policies are PERMISSIVE (OR-combined) in Postgres. The old
--     `owner_user_id = auth.uid()` policies MUST therefore be dropped, not left
--     alongside the new ones — otherwise they would re-grant access and defeat
--     both org scoping and the viewer read-only role. This migration drops
--     EVERY existing policy on each converted table by name from pg_policies
--     before creating the org-scoped set.
--
--  6. Tables intentionally NOT converted (still owner-scoped):
--       diagnosis_sessions, diagnosis_messages, audit_logs, beta_feedback,
--       app_events, ownership_transfers, profiles.
--     Diagnosis is a personal, out-of-scope feature; audit/analytics rows are
--     per-user by design; ownership_transfers is cross-org by nature and has no
--     owner_user_id column. Converting them is deliberately deferred.
--
-- NON-DESTRUCTIVE: no table is dropped or recreated, no row is deleted, no id
-- is regenerated, no passport token is touched. Existing share URLs keep
-- working because transfer_tokens.token_hash is never modified.
--
-- Idempotent: safe to re-run.
-- =============================================================================


-- =============================================================================
-- 1. organizations
-- =============================================================================
create table if not exists public.organizations (
  id                  uuid primary key default gen_random_uuid(),
  name                text not null check (length(btrim(name)) > 0),
  business_type       text,
  contact_name        text,
  phone               text,
  email               text,
  subscription_status text not null default 'trial'
                        check (subscription_status in ('trial', 'active', 'past_due', 'canceled')),
  plan                text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

drop trigger if exists organizations_set_updated_at on public.organizations;
create trigger organizations_set_updated_at
  before update on public.organizations
  for each row execute function public.set_updated_at();

alter table public.organizations enable row level security;


-- =============================================================================
-- 2. profiles: organization membership + role
-- =============================================================================
alter table public.profiles
  add column if not exists organization_id uuid references public.organizations(id) on delete restrict,
  add column if not exists role text not null default 'owner';

-- Roles are a constrained text value (the project uses CHECK constraints, not
-- Postgres enums, everywhere else — follow the existing convention).
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles
  add constraint profiles_role_check
  check (role in ('owner', 'admin', 'fleet_manager', 'viewer'));

create index if not exists profiles_organization_id_idx on public.profiles (organization_id);


-- =============================================================================
-- 3. Organization context helpers
-- =============================================================================
-- SECURITY DEFINER so they can read profiles without being subject to the
-- profiles RLS policy (which would otherwise recurse when a policy on another
-- table calls them). `stable` lets the planner call them once per statement.

create or replace function public.current_org_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.organization_id
  from public.profiles p
  where p.id = auth.uid();
$$;

comment on function public.current_org_id() is
  'The authenticated user''s organization. Never accepts a client-supplied id.';

create or replace function public.current_org_role()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select p.role
  from public.profiles p
  where p.id = auth.uid();
$$;

-- Write access: everyone except `viewer`. Viewer is strictly read-only.
create or replace function public.is_org_writer()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select p.role in ('owner', 'admin', 'fleet_manager')
     from public.profiles p
     where p.id = auth.uid()),
    false
  );
$$;

grant execute on function public.current_org_id()   to authenticated;
grant execute on function public.current_org_role() to authenticated;
grant execute on function public.is_org_writer()    to authenticated;


-- =============================================================================
-- 4. Backfill: one personal organization per existing profile
-- =============================================================================
-- Runs before organization_id is made NOT NULL anywhere. Existing users keep
-- every row they already had; the org boundary is drawn around each of them
-- individually, so no user gains visibility of another user's data.
do $$
declare
  r record;
  v_org uuid;
  v_name text;
begin
  for r in
    select p.id, p.full_name, u.email
    from public.profiles p
    left join auth.users u on u.id = p.id
    where p.organization_id is null
  loop
    v_name := coalesce(
      nullif(btrim(r.full_name), ''),
      nullif(split_part(coalesce(r.email, ''), '@', 1), ''),
      'My fleet'
    );

    insert into public.organizations (name, contact_name, email)
    values (v_name, nullif(btrim(r.full_name), ''), r.email)
    returning id into v_org;

    update public.profiles
       set organization_id = v_org,
           role = 'owner'
     where id = r.id;
  end loop;
end;
$$;


-- =============================================================================
-- 5. organization_id on every fleet table + backfill + auto-fill trigger + RLS
-- =============================================================================

-- Generic BEFORE INSERT trigger: derive organization_id from the row's owner.
-- SECURITY DEFINER so it can read profiles regardless of the caller's RLS.
create or replace function public.set_organization_id_from_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.organization_id is null then
    select p.organization_id
      into new.organization_id
      from public.profiles p
     where p.id = new.owner_user_id;
  end if;
  return new;
end;
$$;

comment on function public.set_organization_id_from_owner() is
  'Derives organization_id from owner_user_id so no insert path (including the accept_passport RPC) needs to supply it, and clients cannot forge it.';

do $$
declare
  t text;
  pol text;
  v_orphans bigint;
  fleet_tables text[] := array[
    'vehicles',
    'maintenance_logs',
    'issue_logs',
    'vehicle_documents',
    'document_extractions',
    'reminders',
    'vehicle_passports',
    'transfer_tokens',
    'vehicle_insurance',
    'vehicle_registration',
    'vehicle_inspection'
  ];
begin
  foreach t in array fleet_tables loop
    -- Skip tables that do not exist in this database (defensive: the
    -- vehicle_insurance/registration/inspection trio arrived in a later phase).
    if not exists (
      select 1 from information_schema.tables
      where table_schema = 'public' and table_name = t
    ) then
      raise notice 'skipping %: table not present', t;
      continue;
    end if;

    -- 5a. Column (nullable for now).
    execute format(
      'alter table public.%I add column if not exists organization_id uuid references public.organizations(id) on delete restrict',
      t
    );

    -- 5b. Backfill from the row owner's profile.
    execute format(
      'update public.%I r
          set organization_id = p.organization_id
         from public.profiles p
        where p.id = r.owner_user_id
          and r.organization_id is null',
      t
    );

    -- 5c. Only enforce NOT NULL when the backfill fully succeeded. If any row
    --     still has a null organization_id (e.g. an owner with no profile row),
    --     leave the column nullable and shout — never fail the migration in a
    --     way that could leave the database half-converted.
    execute format('select count(*) from public.%I where organization_id is null', t)
      into v_orphans;

    if v_orphans = 0 then
      execute format('alter table public.%I alter column organization_id set not null', t);
    else
      raise warning
        'table %: % row(s) could not be assigned an organization; column left NULLABLE. Investigate before relying on NOT NULL.',
        t, v_orphans;
    end if;

    -- 5d. Index for org-scoped reads.
    execute format(
      'create index if not exists %I on public.%I (organization_id)',
      t || '_organization_id_idx', t
    );

    -- 5e. Auto-fill trigger.
    execute format('drop trigger if exists %I on public.%I', t || '_set_organization_id', t);
    execute format(
      'create trigger %I before insert on public.%I for each row execute function public.set_organization_id_from_owner()',
      t || '_set_organization_id', t
    );

    -- 5f. Drop EVERY existing policy on the table. Policies are permissive
    --     (OR-combined), so any surviving owner-scoped policy would re-open
    --     access and defeat the viewer role. This is the security-critical step.
    for pol in
      select policyname from pg_policies
      where schemaname = 'public' and tablename = t
    loop
      execute format('drop policy if exists %I on public.%I', pol, t);
    end loop;

    -- 5g. Org-scoped policies. Reads: any member of the organization.
    --     Writes: members except `viewer`.
    execute format(
      'create policy %I on public.%I for select using (organization_id = public.current_org_id())',
      t || '_select_org', t
    );
    execute format(
      'create policy %I on public.%I for insert with check (organization_id = public.current_org_id() and public.is_org_writer())',
      t || '_insert_org', t
    );
    execute format(
      'create policy %I on public.%I for update using (organization_id = public.current_org_id() and public.is_org_writer()) with check (organization_id = public.current_org_id() and public.is_org_writer())',
      t || '_update_org', t
    );
    execute format(
      'create policy %I on public.%I for delete using (organization_id = public.current_org_id() and public.is_org_writer())',
      t || '_delete_org', t
    );
  end loop;
end;
$$;


-- =============================================================================
-- 6. organizations RLS
-- =============================================================================
drop policy if exists "organizations_select_own" on public.organizations;
drop policy if exists "organizations_update_own" on public.organizations;

-- A user can read only the organization they belong to.
create policy "organizations_select_own" on public.organizations
  for select using (id = public.current_org_id());

-- Only owner/admin may edit organization settings (fleet_manager and viewer
-- may not — per the Phase 1 permission model).
create policy "organizations_update_own" on public.organizations
  for update using (
    id = public.current_org_id()
    and public.current_org_role() in ('owner', 'admin')
  ) with check (
    id = public.current_org_id()
    and public.current_org_role() in ('owner', 'admin')
  );

-- No INSERT/DELETE policy: organizations are created by the signup trigger
-- (SECURITY DEFINER) and never deleted from the client.


-- =============================================================================
-- 7. New signups get their own organization
-- =============================================================================
-- Replaces the Phase 1 handle_new_user(). Still creates the profile row; now it
-- also provisions a personal organization and makes the user its owner, so a
-- brand-new account is never left without an organization.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org  uuid;
  v_name text;
begin
  v_name := coalesce(
    nullif(btrim(new.raw_user_meta_data->>'full_name'), ''),
    nullif(btrim(new.raw_user_meta_data->>'name'), ''),
    nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
    'My fleet'
  );

  insert into public.organizations (name, email)
  values (v_name, new.email)
  returning id into v_org;

  insert into public.profiles (id, organization_id, role)
  values (new.id, v_org, 'owner')
  on conflict (id) do update
    set organization_id = coalesce(public.profiles.organization_id, excluded.organization_id);

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();


-- =============================================================================
-- 8. Privileges
-- =============================================================================
-- RLS gates the rows; these grants only let `authenticated` reach the tables.
-- `anon` is deliberately omitted everywhere (public passport access goes
-- exclusively through the existing SECURITY DEFINER RPCs).
grant select, update on public.organizations to authenticated;

-- =============================================================================
-- End of migration
-- =============================================================================

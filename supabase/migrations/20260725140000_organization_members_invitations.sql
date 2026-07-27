-- =============================================================================
-- Vin.ID Fleet Lite — organization members + invitations
-- =============================================================================
-- Makes explicit MEMBERSHIP the source of truth for organization authorization,
-- and adds invitations so an owner/admin can bring colleagues into the org.
--
-- Key decisions (see docs/fleet-lite-members-invitations.md):
--
--  * `organization_members` is the authority. The org-resolution helpers
--    (current_org_id / current_org_role / is_org_writer / is_org_admin) now read
--    from it, so EVERY existing org-scoped RLS policy and every Storage helper
--    becomes membership-driven automatically — no policy rewrites needed.
--
--  * `profiles.organization_id` / `profiles.role` are kept as a denormalized
--    "current org" cache (handy for the signup default and quick reads) but they
--    no longer independently grant access: a profile pointer without a matching
--    membership row resolves to no access.
--
--  * BOOTCAMP CONSTRAINT: one active organization per user, enforced by
--    UNIQUE(user_id) on organization_members. Multi-org membership is a later
--    change (drop the constraint + add a current-org selector).
--
--  * Invitations store only a token HASH (sha256). The raw token is shown once
--    in the copyable link and never persisted — same pattern as transfer_tokens.
--
--  * Last-owner protection is enforced by a trigger (defense in depth) AND in
--    the service layer: the final owner of an org cannot be removed or demoted.
--
-- Non-destructive and idempotent.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. organization_members  (source of truth for authorization)
-- -----------------------------------------------------------------------------
create table if not exists public.organization_members (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id         uuid not null references auth.users(id) on delete cascade,
  role            text not null default 'viewer'
                    check (role in ('owner', 'admin', 'fleet_manager', 'viewer')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  -- One active organization per user (bootcamp constraint).
  constraint organization_members_user_unique unique (user_id)
);

create index if not exists organization_members_org_idx on public.organization_members (organization_id);
create index if not exists organization_members_role_idx on public.organization_members (organization_id, role);

drop trigger if exists organization_members_set_updated_at on public.organization_members;
create trigger organization_members_set_updated_at
  before update on public.organization_members
  for each row execute function public.set_updated_at();

alter table public.organization_members enable row level security;

-- -----------------------------------------------------------------------------
-- 2. organization_invitations
-- -----------------------------------------------------------------------------
create table if not exists public.organization_invitations (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  email           text not null check (length(btrim(email)) > 0),
  role            text not null default 'fleet_manager'
                    check (role in ('admin', 'fleet_manager', 'viewer')),
  token_hash      text not null unique,
  invited_by      uuid references auth.users(id) on delete set null,
  status          text not null default 'pending'
                    check (status in ('pending', 'accepted', 'revoked', 'expired')),
  created_at      timestamptz not null default now(),
  expires_at      timestamptz not null default (now() + interval '7 days'),
  accepted_at     timestamptz,
  accepted_by     uuid references auth.users(id) on delete set null,
  revoked_at      timestamptz
);

create index if not exists organization_invitations_org_idx on public.organization_invitations (organization_id);
create index if not exists organization_invitations_email_idx on public.organization_invitations (lower(email));
-- At most one pending invitation per (org, email).
create unique index if not exists organization_invitations_unique_pending
  on public.organization_invitations (organization_id, lower(email))
  where status = 'pending';

alter table public.organization_invitations enable row level security;

-- -----------------------------------------------------------------------------
-- 3. Backfill membership from existing profiles.
--    Every profile that already has an organization becomes a member with the
--    same role. Runs before the helpers are switched over.
-- -----------------------------------------------------------------------------
insert into public.organization_members (organization_id, user_id, role)
select p.organization_id, p.id, p.role
from public.profiles p
where p.organization_id is not null
on conflict (user_id) do nothing;

-- -----------------------------------------------------------------------------
-- 4. Reroute the org-resolution helpers to read MEMBERSHIP.
--    Because every org RLS policy and Storage helper calls these, this single
--    switch makes the whole app membership-driven.
-- -----------------------------------------------------------------------------
create or replace function public.current_org_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.organization_id
  from public.organization_members m
  where m.user_id = auth.uid();
$$;

create or replace function public.current_org_role()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select m.role
  from public.organization_members m
  where m.user_id = auth.uid();
$$;

create or replace function public.is_org_writer()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select m.role in ('owner', 'admin', 'fleet_manager')
     from public.organization_members m
     where m.user_id = auth.uid()),
    false
  );
$$;

-- NEW: owner/admin — may manage organization settings, members and invitations.
create or replace function public.is_org_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select m.role in ('owner', 'admin')
     from public.organization_members m
     where m.user_id = auth.uid()),
    false
  );
$$;

grant execute on function public.is_org_admin() to authenticated;

-- Count owners of an organization (used by last-owner protection).
create or replace function public.org_owner_count(p_org uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::int
  from public.organization_members m
  where m.organization_id = p_org and m.role = 'owner';
$$;

-- -----------------------------------------------------------------------------
-- 5. Last-owner protection: an org must always keep at least one owner.
-- -----------------------------------------------------------------------------
-- The invariant is "an organization must never have MEMBERS but no owner".
-- Removing or demoting the sole owner is therefore blocked ONLY while OTHER
-- members remain in that org. When the owner is the only member (a personal
-- org, an org being emptied, or a user/org cascade delete), the operation is
-- allowed — it just leaves an empty org, which is harmless and lets cascades and
-- account deletion work. `old.id <> m.id` excludes the row being changed.
create or replace function public.protect_last_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_others_remain boolean;
begin
  if tg_op = 'DELETE' then
    if old.role = 'owner'
       and public.org_owner_count(old.organization_id) <= 1 then
      select exists (
        select 1 from public.organization_members m
        where m.organization_id = old.organization_id and m.id <> old.id
      ) into v_others_remain;
      if v_others_remain then
        raise exception 'cannot remove the last owner while other members remain'
          using errcode = 'check_violation';
      end if;
    end if;
    return old;
  elsif tg_op = 'UPDATE' then
    -- Only a pure in-org role change (same org) can "demote" the last owner.
    -- Moving the row to another org is not a demotion of the old org here.
    if old.organization_id = new.organization_id
       and old.role = 'owner' and new.role <> 'owner'
       and public.org_owner_count(old.organization_id) <= 1 then
      select exists (
        select 1 from public.organization_members m
        where m.organization_id = old.organization_id and m.id <> old.id
      ) into v_others_remain;
      if v_others_remain then
        raise exception 'cannot demote the last owner while other members remain'
          using errcode = 'check_violation';
      end if;
    end if;
    return new;
  end if;
  return null;
end;
$$;

drop trigger if exists organization_members_protect_last_owner on public.organization_members;
create trigger organization_members_protect_last_owner
  before update or delete on public.organization_members
  for each row execute function public.protect_last_owner();

-- -----------------------------------------------------------------------------
-- 6. RLS — organization_members
-- -----------------------------------------------------------------------------
drop policy if exists "org_members_select_same_org" on public.organization_members;
create policy "org_members_select_same_org" on public.organization_members
  for select using (organization_id = public.current_org_id());

-- Admins manage members within their own org. Membership is normally created by
-- the accept_invitation RPC (SECURITY DEFINER, bypasses RLS); a direct admin
-- insert is allowed for completeness but must target the admin's own org.
drop policy if exists "org_members_insert_admin" on public.organization_members;
create policy "org_members_insert_admin" on public.organization_members
  for insert with check (
    organization_id = public.current_org_id() and public.is_org_admin()
  );

drop policy if exists "org_members_update_admin" on public.organization_members;
create policy "org_members_update_admin" on public.organization_members
  for update using (
    organization_id = public.current_org_id() and public.is_org_admin()
  ) with check (
    organization_id = public.current_org_id() and public.is_org_admin()
  );

drop policy if exists "org_members_delete_admin" on public.organization_members;
create policy "org_members_delete_admin" on public.organization_members
  for delete using (
    organization_id = public.current_org_id() and public.is_org_admin()
  );

-- -----------------------------------------------------------------------------
-- 7. RLS — organization_invitations (owner/admin only; no anon)
-- -----------------------------------------------------------------------------
drop policy if exists "org_invitations_select_admin" on public.organization_invitations;
create policy "org_invitations_select_admin" on public.organization_invitations
  for select using (
    organization_id = public.current_org_id() and public.is_org_admin()
  );

drop policy if exists "org_invitations_insert_admin" on public.organization_invitations;
create policy "org_invitations_insert_admin" on public.organization_invitations
  for insert with check (
    organization_id = public.current_org_id()
    and public.is_org_admin()
    and invited_by = auth.uid()
  );

drop policy if exists "org_invitations_update_admin" on public.organization_invitations;
create policy "org_invitations_update_admin" on public.organization_invitations
  for update using (
    organization_id = public.current_org_id() and public.is_org_admin()
  ) with check (
    organization_id = public.current_org_id() and public.is_org_admin()
  );
-- No DELETE policy: invitations are revoked (status change), never hard-deleted.

-- -----------------------------------------------------------------------------
-- 8. New signups: create org + profile + OWNER membership.
-- -----------------------------------------------------------------------------
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

  insert into public.organization_members (organization_id, user_id, role)
  values (v_org, new.id, 'owner')
  on conflict (user_id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- -----------------------------------------------------------------------------
-- 9. Privileges (RLS still gates rows; anon intentionally omitted).
-- -----------------------------------------------------------------------------
grant select, insert, update, delete on public.organization_members to authenticated;
grant select, insert, update, delete on public.organization_invitations to authenticated;

-- =============================================================================
-- End of migration
-- =============================================================================

-- =============================================================================
-- Vin.ID multi-workspace — M4: one membership per user PER ORGANIZATION
-- =============================================================================
-- THE POINT OF NO RETURN. Everything before this is additive and reversible by
-- dropping a column. From here on a user may hold several memberships, and once
-- one actually does, UNIQUE(user_id) cannot be restored without deciding which
-- of their memberships to delete — a data decision, not a rollback.
--
-- DO NOT APPLY WITHOUT M3. M3 rewrites the six helpers that read
-- `organization_members where user_id = auth.uid()` with no organization filter.
-- Without it, the first user to hold two memberships gets either a silent
-- cross-tenant read (current_org_id returns an arbitrary row) or an
-- application-wide 500 (is_org_writer raises on a multi-row subquery). Both
-- were reproduced locally. M3 is behaviour-identical under the old constraint,
-- so it is safe to ship well ahead of this file.
--
-- WHAT REPLACES IT. UNIQUE(organization_id, user_id): a user may belong to many
-- organizations, but never twice to the same one. That is what makes invitation
-- replay idempotent at the database level rather than only in the RPC.
--
-- PRESERVED: every existing membership row, its role, organization ownership,
-- the last-owner trigger, invitations and driver assignments. Nothing is
-- deleted, moved or re-created — this is a constraint swap, not a data change.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Refuse to run if the new constraint could not hold. A duplicate
--    (organization_id, user_id) pair cannot exist under UNIQUE(user_id), so
--    this should always find zero — but a migration that silently half-applies
--    is worse than one that stops.
-- -----------------------------------------------------------------------------
do $$
declare v_dupes int;
begin
  select count(*) into v_dupes from (
    select organization_id, user_id
    from public.organization_members
    group by organization_id, user_id
    having count(*) > 1
  ) d;

  if v_dupes > 0 then
    raise exception
      'membership_cardinality: % duplicate (organization_id, user_id) pair(s); refusing to swap the constraint', v_dupes;
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- 2. Swap the constraint. Order matters: create the new one FIRST, so there is
--    never an instant in this transaction where nothing prevents a duplicate
--    membership in the same organization.
-- -----------------------------------------------------------------------------
alter table public.organization_members
  drop constraint if exists organization_members_org_user_unique;
alter table public.organization_members
  add constraint organization_members_org_user_unique
  unique (organization_id, user_id);

alter table public.organization_members
  drop constraint if exists organization_members_user_unique;

comment on constraint organization_members_org_user_unique on public.organization_members is
  'A user may belong to many organizations, but never twice to the same one. This is what makes invitation replay idempotent in the database, not just in accept_invitation().';

-- Listing a user's memberships is now a routine query (the workspace selector,
-- every current_org_id() fallback), so it gets its own index. The old unique
-- constraint used to provide this incidentally.
create index if not exists organization_members_user_idx
  on public.organization_members (user_id, created_at, id);

-- -----------------------------------------------------------------------------
-- 3. Signup: the conflict target must name a constraint that still exists.
--
--    This is in the SAME migration as the drop on purpose. `on conflict
--    (user_id)` raises "there is no unique or exclusion constraint matching the
--    ON CONFLICT specification" the moment the old constraint disappears —
--    which means signup itself breaks. Verified locally by dropping the
--    constraint alone and watching auth.users inserts fail. Splitting these two
--    statements across migrations would leave exactly that window open.
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
    'My vehicles'
  );

  insert into public.organizations (name, email, kind)
  values (v_name, new.email, 'personal')
  returning id into v_org;

  insert into public.profiles (id, organization_id, role)
  values (new.id, v_org, 'owner')
  on conflict (id) do update
    set organization_id = coalesce(public.profiles.organization_id, excluded.organization_id);

  -- New target. A user can now hold several memberships, so the only thing
  -- worth ignoring is a repeat of THIS membership.
  insert into public.organization_members (organization_id, user_id, role)
  values (v_org, new.id, 'owner')
  on conflict (organization_id, user_id) do nothing;

  -- The personal workspace is where a new user starts.
  update public.profiles
     set active_organization_id = v_org
   where id = new.id
     and active_organization_id is null;

  return new;
end;
$$;

-- Verification (all expect 0):
--   duplicate membership in one organization
--     select count(*) from (select organization_id, user_id
--       from public.organization_members group by 1,2 having count(*)>1) d;
--   organizations left without an owner
--     select count(*) from public.organizations o where not exists (
--       select 1 from public.organization_members m
--       where m.organization_id=o.id and m.role='owner');

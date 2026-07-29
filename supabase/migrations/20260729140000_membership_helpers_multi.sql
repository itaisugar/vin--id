-- =============================================================================
-- Vin.ID multi-workspace — M3: make every tenant helper multi-membership safe
-- =============================================================================
-- THIS MIGRATION IS THE SAFETY ARGUMENT FOR M4. It must be applied BEFORE the
-- uniqueness constraint is dropped, and it is deliberately a separate file so
-- the two can be deployed in separate releases if the rollout demands it.
--
-- WHAT IS WRONG TODAY. Six helpers read
--
--     select … from public.organization_members where user_id = auth.uid()
--
-- with no organization filter and no LIMIT. Both failure modes were reproduced
-- locally against a second membership before this rewrite:
--
--   current_org_id()   -> returns an ARBITRARY row, silently. A `language sql`
--                         scalar function whose body yields several rows returns
--                         the first one in whatever order the plan produced.
--                         That is a cross-tenant read with no error anywhere.
--   is_org_writer()    -> ERROR: more than one row returned by a subquery used
--                         as an expression. Every write policy calls it, so the
--                         application 500s across the board.
--     (is_org_admin, is_org_driver, can_manage_driver_assignments: identical)
--
-- WHAT THIS DOES. Every helper now resolves THE ACTIVE ORGANIZATION first and
-- answers within it. Resolution order, defined once in current_org_id() and
-- reused by everything else:
--
--   1. profiles.active_organization_id, IF the caller still has a membership
--      in that organization                     <- the validation join
--   2. else the caller's personal organization  (organizations.kind='personal')
--   3. else the oldest membership               (created_at, then id — total
--                                                and stable, so "arbitrary" is
--                                                not a possible outcome)
--   4. else NULL
--
-- BEHAVIOUR IS IDENTICAL WHILE UNIQUE(user_id) STILL HOLDS. With exactly one
-- membership, steps 1-3 all resolve to that same row. This migration is
-- therefore a no-op for every existing user, which is what makes it safe to
-- ship ahead of M4.
--
-- Idempotent: every function is CREATE OR REPLACE with an unchanged signature,
-- so the 56 RLS policies and 11 functions that call them are untouched.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. The one resolution rule.
-- -----------------------------------------------------------------------------
create or replace function public.current_org_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    -- 1. The active pointer — ONLY when a live membership backs it. This join
    --    is what stops UI state from becoming an authorization decision: a
    --    forged or stale pointer matches nothing and falls through.
    (select m.organization_id
     from public.profiles p
     join public.organization_members m
       on m.organization_id = p.active_organization_id
      and m.user_id = p.id
     where p.id = auth.uid()),

    -- 2. The user's own personal workspace.
    (select m.organization_id
     from public.organization_members m
     join public.organizations o on o.id = m.organization_id
     where m.user_id = auth.uid()
       and o.kind = 'personal'
     order by m.created_at, m.id
     limit 1),

    -- 3. Oldest membership. Total ordering on (created_at, id) — never
    --    "whichever row the planner produced first".
    (select m.organization_id
     from public.organization_members m
     where m.user_id = auth.uid()
     order by m.created_at, m.id
     limit 1)
  );
$$;

comment on function public.current_org_id() is
  'The organization the caller is currently acting in. Resolution: validated active pointer, else personal workspace, else oldest membership, else NULL. Never accepts a client-supplied id, and never returns an organization the caller does not belong to.';

-- -----------------------------------------------------------------------------
-- 2. Role within THAT organization.
--
--    Previously "the caller's role"; now "the caller's role HERE". With several
--    memberships a global role is not a coherent idea — the same person may own
--    one organization and drive for another.
-- -----------------------------------------------------------------------------
create or replace function public.current_org_role()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select m.role
  from public.organization_members m
  where m.user_id = auth.uid()
    and m.organization_id = public.current_org_id();
$$;

comment on function public.current_org_role() is
  'The caller''s role IN THE ACTIVE ORGANIZATION. Role is per membership: the same user may be an owner in one organization and a driver in another.';

-- -----------------------------------------------------------------------------
-- 3. Role predicates, all scoped the same way.
--
--    `exists (…)` rather than `coalesce((select …), false)`: exists is true or
--    false for any number of matching rows, so this shape cannot raise the
--    multi-row subquery error that the old one did.
-- -----------------------------------------------------------------------------
create or replace function public.is_org_writer()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.organization_members m
    where m.user_id = auth.uid()
      and m.organization_id = public.current_org_id()
      and m.role in ('owner', 'admin', 'fleet_manager')
  );
$$;

create or replace function public.is_org_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.organization_members m
    where m.user_id = auth.uid()
      and m.organization_id = public.current_org_id()
      and m.role in ('owner', 'admin')
  );
$$;

create or replace function public.is_org_driver()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.organization_members m
    where m.user_id = auth.uid()
      and m.organization_id = public.current_org_id()
      and m.role = 'driver'
  );
$$;

create or replace function public.can_manage_driver_assignments()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.organization_members m
    where m.user_id = auth.uid()
      and m.organization_id = public.current_org_id()
      and m.role in ('owner', 'admin', 'fleet_manager')
  );
$$;

-- -----------------------------------------------------------------------------
-- 4. Driver resolution, scoped to the active organization.
--
--    A driver in organization B who is also an owner in their own personal
--    workspace must not have B's vehicle follow them into A. The added
--    organization filter is what keeps Driver View inside the active workspace.
-- -----------------------------------------------------------------------------
create or replace function public.current_driver_vehicle_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select a.vehicle_id
  from public.driver_assignments a
  join public.organization_members m
    on m.id = a.member_id
   and m.user_id = a.driver_user_id
   and m.organization_id = a.organization_id
  join public.vehicles v
    on v.id = a.vehicle_id
   and v.organization_id = a.organization_id
  where a.driver_user_id = auth.uid()
    and a.organization_id = public.current_org_id()
    and a.unassigned_at is null
    and m.role = 'driver'
    and v.deleted_at is null
  order by a.assigned_at desc, a.id
  limit 1;
$$;

comment on function public.current_driver_vehicle_id() is
  'The vehicle assigned to the caller IN THE ACTIVE ORGANIZATION. Ordered, so the result is deterministic rather than whichever row the planner produced.';

-- -----------------------------------------------------------------------------
-- 5. Personal-workspace predicate, for the UI.
-- -----------------------------------------------------------------------------
create or replace function public.is_personal_workspace()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.organizations o
    where o.id = public.current_org_id()
      and o.kind = 'personal'
  );
$$;

comment on function public.is_personal_workspace() is
  'True when the active workspace is the caller''s personal one. Presentation only.';

-- -----------------------------------------------------------------------------
-- 6. Privileges. Unchanged shape: revoke from public/anon, grant to
--    authenticated. `anon` keeps EXECUTE only on the helpers that anon-facing
--    RLS policies plan against — revoking those would make an anonymous query
--    RAISE instead of returning zero rows.
-- -----------------------------------------------------------------------------
revoke all on function public.is_personal_workspace() from public, anon;
grant execute on function public.is_personal_workspace() to authenticated;

-- Verification (expect true for every user, with one membership or many):
--   the resolved organization is always one the caller belongs to.
--   select count(*) from public.profiles p
--   where public.current_org_id() is not null
--     and not exists (select 1 from public.organization_members m
--                     where m.user_id = p.id
--                       and m.organization_id = public.current_org_id());

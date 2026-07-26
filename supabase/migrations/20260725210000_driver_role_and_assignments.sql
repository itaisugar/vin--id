-- =============================================================================
-- Vin.ID Fleet Lite — driver role + driver assignments
-- =============================================================================
-- Adds a fifth organization role, `driver`, and the assignment model that binds
-- an authenticated driver to exactly one vehicle.
--
-- ORDER MATTERS. This migration only defines the role and the data model; it
-- does NOT yet let anyone hold the role in a way that grants access, because the
-- existing RLS policies are all bare `organization_id = current_org_id()` with
-- no role condition. Handing someone the `driver` role against those policies
-- would give them org-wide read of every vehicle, every maintenance log
-- (including cost, currency and vendor), every issue, every reminder and every
-- document. The very next migration (20260725220000_driver_rls.sql) rewrites
-- those policies to be driver-aware. The two must ship together.
--
-- `driver` is NOT a narrower `viewer`. A viewer is organization-wide read-only;
-- a driver is restricted to a single vehicle and a small allowlist of related
-- records. They are separate roles with separate rules.
--
-- BOOTCAMP LIMITATION (documented, enforced in the database):
--   * one ACTIVE driver per vehicle
--   * one ACTIVE vehicle per driver
-- Both enforced by partial unique indexes on `unassigned_at is null`. Multi-
-- driver shifts, scheduling and rotations are explicitly out of scope. Historical
-- assignments are retained and remain queryable.
--
-- Non-destructive and idempotent.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Allow the new role
-- -----------------------------------------------------------------------------
alter table public.organization_members
  drop constraint if exists organization_members_role_check;
alter table public.organization_members
  add constraint organization_members_role_check
  check (role in ('owner', 'admin', 'fleet_manager', 'viewer', 'driver'));

-- Invitations may carry `driver`. `owner` remains un-invitable: ownership is
-- granted by promoting an existing member, never by emailing a link.
alter table public.organization_invitations
  drop constraint if exists organization_invitations_role_check;
alter table public.organization_invitations
  add constraint organization_invitations_role_check
  check (role in ('admin', 'fleet_manager', 'viewer', 'driver'));

-- `profiles.role` is only the display cache, but `accept_invitation()` and the
-- member-role service both write it in the same transaction as the membership.
-- Leaving its CHECK constraint behind would make accepting a driver invitation
-- fail outright — caught at runtime before any UI existed.
alter table public.profiles
  drop constraint if exists profiles_role_check;
alter table public.profiles
  add constraint profiles_role_check
  check (role in ('owner', 'admin', 'fleet_manager', 'viewer', 'driver'));

-- -----------------------------------------------------------------------------
-- 2. Composite keys, so "same organization" is a database guarantee
-- -----------------------------------------------------------------------------
-- Without these, `driver_assignments` could only *promise* that its vehicle and
-- its member belong to the organization named on the row. With them, a mismatch
-- is impossible to insert — no trigger, no application check, no race.
alter table public.vehicles
  drop constraint if exists vehicles_id_organization_key;
alter table public.vehicles
  add constraint vehicles_id_organization_key unique (id, organization_id);

alter table public.organization_members
  drop constraint if exists organization_members_id_organization_key;
alter table public.organization_members
  add constraint organization_members_id_organization_key unique (id, organization_id);

-- -----------------------------------------------------------------------------
-- 3. driver_assignments
-- -----------------------------------------------------------------------------
create table if not exists public.driver_assignments (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  vehicle_id      uuid not null,
  -- The membership that was assigned. ON DELETE SET NULL rather than CASCADE so
  -- removing someone from the organization does not erase the history of what
  -- they drove. Access is never granted from this row alone — the helpers below
  -- re-check live membership — so a dangling historical row is inert.
  member_id       uuid,
  -- The authenticated user. This, not any free-text name, is what authorizes.
  driver_user_id  uuid not null references auth.users(id) on delete cascade,
  assigned_by     uuid references auth.users(id) on delete set null,
  assigned_at     timestamptz not null default now(),
  unassigned_at   timestamptz,
  note            text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  -- The vehicle must live in the assignment's organization.
  constraint driver_assignments_vehicle_org_fkey
    foreign key (vehicle_id, organization_id)
    references public.vehicles (id, organization_id) on delete cascade,
  -- The membership must live in the assignment's organization.
  --
  -- `set null (member_id)` names the column deliberately. A bare SET NULL on a
  -- composite foreign key nulls EVERY referencing column, including
  -- organization_id, which is NOT NULL — so removing a member who had any
  -- assignment history failed outright. Verified at runtime before any UI
  -- existed. Naming the column detaches the history from the deleted membership
  -- and leaves the organization intact.
  constraint driver_assignments_member_org_fkey
    foreign key (member_id, organization_id)
    references public.organization_members (id, organization_id)
    on delete set null (member_id),

  constraint driver_assignments_period_valid
    check (unassigned_at is null or unassigned_at >= assigned_at)
);

-- BOOTCAMP LIMITATION, enforced rather than hoped for.
create unique index if not exists driver_assignments_one_active_per_vehicle
  on public.driver_assignments (vehicle_id) where unassigned_at is null;
create unique index if not exists driver_assignments_one_active_per_driver
  on public.driver_assignments (driver_user_id) where unassigned_at is null;

create index if not exists driver_assignments_org_idx
  on public.driver_assignments (organization_id);
create index if not exists driver_assignments_vehicle_idx
  on public.driver_assignments (vehicle_id, assigned_at desc);
create index if not exists driver_assignments_driver_active_idx
  on public.driver_assignments (driver_user_id) where unassigned_at is null;

drop trigger if exists driver_assignments_set_updated_at on public.driver_assignments;
create trigger driver_assignments_set_updated_at
  before update on public.driver_assignments
  for each row execute function public.set_updated_at();

alter table public.driver_assignments enable row level security;

-- -----------------------------------------------------------------------------
-- 4. Only a `driver` member may be assigned
-- -----------------------------------------------------------------------------
-- Checked on INSERT and on any change of member, so a manager cannot park a
-- vehicle on an owner/admin/viewer and quietly hand them a Driver View.
create or replace function public.enforce_assignment_member_is_driver()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text;
  v_user uuid;
begin
  -- A NEW assignment must name a member. An EXISTING row may lose its member
  -- when that membership is deleted (the FK detaches it, keeping the history);
  -- that row then grants nothing, because current_driver_vehicle_id() joins
  -- through member_id and finds no live membership.
  if new.member_id is null then
    if tg_op = 'INSERT' then
      raise exception 'a driver assignment requires a member'
        using errcode = 'check_violation';
    end if;
    return new;
  end if;

  select m.role, m.user_id into v_role, v_user
  from public.organization_members m
  where m.id = new.member_id;

  if v_role is distinct from 'driver' then
    raise exception 'assigned member must hold the driver role (got %)', coalesce(v_role, 'none')
      using errcode = 'check_violation';
  end if;

  -- The user column must describe the same person as the membership.
  if new.driver_user_id is distinct from v_user then
    raise exception 'driver_user_id does not match the assigned membership'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists driver_assignments_member_is_driver on public.driver_assignments;
create trigger driver_assignments_member_is_driver
  before insert or update of member_id, driver_user_id on public.driver_assignments
  for each row execute function public.enforce_assignment_member_is_driver();

-- -----------------------------------------------------------------------------
-- 5. Centralized driver helpers
-- -----------------------------------------------------------------------------
-- All SECURITY DEFINER with a pinned empty search_path and no dynamic SQL. None
-- of them reads a client-supplied organization or user id: the caller is always
-- auth.uid(). None queries a table whose own RLS calls back into them, so there
-- is no recursive policy evaluation.

/** True when the caller's membership role is `driver`. */
create or replace function public.is_org_driver()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select m.role = 'driver'
     from public.organization_members m
     where m.user_id = auth.uid()),
    false
  );
$$;

/**
 * The vehicle of the caller's ACTIVE assignment, or NULL.
 *
 * Deliberately re-joins `organization_members` and re-checks the driver role, so
 * a historical assignment row belonging to someone whose membership was removed
 * or whose role was changed grants exactly nothing.
 *
 * Also joins `vehicles` to drop soft-deleted vehicles: an assignment that was
 * never ended before the vehicle was deleted must not keep resolving. Reading
 * `vehicles` here does NOT recurse into the vehicles policy — this function is
 * SECURITY DEFINER and therefore runs as the table owner, for whom RLS is not
 * applied.
 */
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
    and a.unassigned_at is null
    and m.role = 'driver'
    and v.deleted_at is null
  limit 1;
$$;

/**
 * May the caller read this vehicle?
 *
 * A driver may read exactly the vehicle in their active assignment. Every other
 * role keeps the organization-wide rule.
 *
 * NOT USABLE AS THE `vehicles` SELECT POLICY. This function is STABLE and, for a
 * non-driver, answers by re-querying `public.vehicles`. A STABLE function reads
 * the statement-start snapshot, so under `INSERT ... RETURNING` — which is what
 * every `.insert().select()` in the app issues, and to which Postgres applies
 * the SELECT policy — the new row is invisible to it and the statement fails
 * with "new row violates row-level security policy". The vehicles policy
 * therefore compares `organization_id` on the row itself; see the note in
 * 20260725220000_driver_rls.sql. Use this helper only where the vehicle already
 * exists, i.e. never inside a policy on `vehicles` itself.
 */
create or replace function public.can_access_vehicle(p_vehicle uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_vehicle is null then false
    when public.is_org_driver()
      then p_vehicle = public.current_driver_vehicle_id()
    else exists (
      select 1 from public.vehicles v
      where v.id = p_vehicle
        and v.organization_id = public.current_org_id()
    )
  end;
$$;

/** Roles permitted to create, replace and end driver assignments. */
create or replace function public.can_manage_driver_assignments()
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

revoke all on function public.is_org_driver() from public;
revoke all on function public.current_driver_vehicle_id() from public;
revoke all on function public.can_access_vehicle(uuid) from public;
revoke all on function public.can_manage_driver_assignments() from public;
-- `anon` is granted the three POLICY helpers, and only those. They are all
-- driven by auth.uid(), which is NULL for an anonymous caller, so each returns
-- false/NULL and nothing leaks. The grant exists because these functions appear
-- inside policy expressions on tables `anon` holds a table grant for: Postgres
-- checks EXECUTE when the policy is planned, so without it an anonymous SELECT
-- would raise "permission denied for function" instead of returning zero rows.
-- The driver DATA functions in the companion migration are authenticated-only.
grant execute on function public.is_org_driver() to anon, authenticated;
grant execute on function public.current_driver_vehicle_id() to anon, authenticated;
grant execute on function public.can_access_vehicle(uuid) to anon, authenticated;
grant execute on function public.can_manage_driver_assignments() to authenticated;

-- -----------------------------------------------------------------------------
-- 6. RLS — driver_assignments
-- -----------------------------------------------------------------------------
-- Managers see the organization's assignment history. A driver sees only their
-- own rows — never another driver's history, never the roster.
drop policy if exists "driver_assignments_select" on public.driver_assignments;
create policy "driver_assignments_select" on public.driver_assignments
  for select using (
    organization_id = public.current_org_id()
    and (
      public.can_manage_driver_assignments()
      or driver_user_id = auth.uid()
    )
  );

-- Writes go through the RPCs below, which are atomic. Direct writes are still
-- permitted for managers within their own organization, and are still subject to
-- the driver-role trigger and the one-active partial unique indexes.
drop policy if exists "driver_assignments_insert" on public.driver_assignments;
create policy "driver_assignments_insert" on public.driver_assignments
  for insert with check (
    organization_id = public.current_org_id()
    and public.can_manage_driver_assignments()
  );

drop policy if exists "driver_assignments_update" on public.driver_assignments;
create policy "driver_assignments_update" on public.driver_assignments
  for update using (
    organization_id = public.current_org_id()
    and public.can_manage_driver_assignments()
  ) with check (
    organization_id = public.current_org_id()
    and public.can_manage_driver_assignments()
  );
-- No DELETE policy: assignments are ended (unassigned_at), never erased.

grant select, insert, update on public.driver_assignments to authenticated;

comment on table public.driver_assignments is
  'Binds an authenticated driver member to one vehicle. One active driver per vehicle and one active vehicle per driver, enforced by partial unique indexes. Ended assignments are retained as history and grant nothing.';

-- =============================================================================
-- End of migration
-- =============================================================================

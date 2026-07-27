-- =============================================================================
-- Vin.ID Fleet Lite — strict last-owner invariant
-- =============================================================================
-- Tightens the protection added in 20260725140000. The intended invariant is:
--
--     An organization that continues to exist must never be left without an
--     owner.
--
-- The first version only blocked removing/demoting the last owner while OTHER
-- members remained, so a sole owner could delete or demote their own membership
-- and leave a live organization (with vehicles, documents and invitations)
-- ownerless and unmanageable. This migration enforces the invariant strictly.
--
-- Behaviour matrix (all enforced in the database):
--
--   removal/demotion of the last owner, org alive   -> rejected
--   removal/demotion when another owner exists      -> allowed
--   moving the last owner to a different org        -> rejected
--   organization deleted (cascade to memberships)   -> allowed
--   non-owner account deleted (cascade)             -> allowed
--   co-owner account deleted (cascade)              -> allowed
--   SOLE-OWNER account deleted while org alive      -> rejected
--
-- Sole-owner account deletion is deliberately REJECTED rather than silently
-- orphaning or auto-deleting the organization. The operator must first either
-- promote another member to owner, or delete the organization itself. This
-- keeps account deletion from destroying fleet data as an invisible side
-- effect, and it is the only outcome that satisfies the invariant without
-- weakening it. Callers (including fixture cleanup) must therefore delete the
-- organization before the user.
--
-- Concurrency: the trigger takes a row lock on the parent `organizations` row
-- before counting owners, so concurrent attempts to remove or demote the final
-- two owners serialize; the second one observes a single remaining owner and is
-- rejected. Without the lock both transactions read "2 owners" under READ
-- COMMITTED and the organization ends up with none.
--
-- Non-destructive and idempotent.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. `profiles.organization_id` must not veto organization deletion.
--    It is only a denormalized "current org" cache, so it drops to NULL when the
--    organization goes away. Without this the FK is RESTRICT and deleting an
--    organization fails outright, taking the membership cascade down with it.
--    Every other organization-scoped table deliberately keeps RESTRICT: an
--    organization that still holds fleet data (vehicles, documents, ...) must
--    not be deletable by accident.
-- -----------------------------------------------------------------------------
alter table public.profiles
  drop constraint if exists profiles_organization_id_fkey;

alter table public.profiles
  add constraint profiles_organization_id_fkey
  foreign key (organization_id) references public.organizations(id)
  on delete set null;

-- -----------------------------------------------------------------------------
-- 2. Strict last-owner protection.
-- -----------------------------------------------------------------------------
create or replace function public.protect_last_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org     uuid := old.organization_id;
  v_owners  integer;
  v_leaving boolean;
begin
  -- Serialize every membership mutation for this organization by locking the
  -- parent row. See the concurrency note at the top of this migration.
  perform 1 from public.organizations o where o.id = v_org for update;

  -- The organization row is already gone: this delete is the ON DELETE CASCADE
  -- from `organizations`. There is no surviving organization to leave without an
  -- owner, so the cascade is allowed through.
  if not found then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  if tg_op = 'DELETE' then
    v_leaving := (old.role = 'owner');
  else
    -- An owner stops being this organization's owner either by demotion or by
    -- being moved to a different organization.
    v_leaving := (old.role = 'owner')
             and (new.role <> 'owner' or new.organization_id <> old.organization_id);
  end if;

  if v_leaving then
    select count(*) into v_owners
    from public.organization_members m
    where m.organization_id = v_org
      and m.role = 'owner';

    if v_owners <= 1 then
      raise exception 'organization % must keep at least one owner', v_org
        using errcode = 'check_violation',
              hint    = 'Promote another member to owner first, or delete the organization.';
    end if;
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

comment on function public.protect_last_owner() is
  'Rejects any removal, demotion or cross-org move that would leave a surviving organization without an owner. Allows organization-delete cascades. Locks the parent organizations row so concurrent removals of the final owners cannot race to zero.';

drop trigger if exists organization_members_protect_last_owner on public.organization_members;
create trigger organization_members_protect_last_owner
  before update or delete on public.organization_members
  for each row execute function public.protect_last_owner();

-- =============================================================================
-- End of migration
-- =============================================================================

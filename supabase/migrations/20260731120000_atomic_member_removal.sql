-- =============================================================================
-- Vin.ID multi-workspace — atomic member removal + safe active-workspace repair
-- =============================================================================
-- THE BUG. Owner-side removal was two separate statements: a direct DELETE on
-- organization_members, then a best-effort profiles UPDATE. The UPDATE cleared
-- only the legacy organization_id cache (never active_organization_id) AND could
-- never affect another user's row, because profiles RLS is own-row. So a removed
-- user kept an active_organization_id pointing at an organization they had just
-- left. current_org_id() ignores such a pointer (it validates membership on every
-- read), so it was never a data leak — but it left stale profile state that a
-- single-workspace user cannot clear through the UI, and it required a manual
-- normalization after the R2 QA test.
--
-- THE FIX, in two parts, both inside one transaction:
--
--   1. A trigger, repair_active_workspace_after_member_removal(), fired AFTER
--      DELETE on organization_members FOR EACH ROW. It is the single, authoritative
--      place that keeps the invariant "profiles.active_organization_id always
--      names an organization the user still belongs to (or NULL)". Because it
--      fires for EVERY delete — the RPC below, a direct service-role delete, or a
--      future self-leave path — the repair can never be forgotten by a caller.
--
--   2. An RPC, remove_organization_member(uuid), that authorizes the caller,
--      deletes exactly one membership, and returns a structured result. Its DELETE
--      fires the trigger, so the RPC never duplicates the repair logic.
--
-- Resolution order for the repaired pointer mirrors current_org_id() exactly:
-- personal workspace, else oldest remaining membership by (created_at, id), else
-- NULL. The legacy organization_id / role caches are kept in step so a row read
-- by hand is not misleading; neither is authoritative.
--
-- No schema or column change. Idempotent (CREATE OR REPLACE + DROP TRIGGER IF
-- EXISTS). RLS unchanged. current_org_id() and protect_last_owner() unchanged.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. The repair. SECURITY DEFINER so it can write the removed user's profile row
--    regardless of who executed the delete; search_path pinned; fully schema-
--    qualified. It only ever touches ONE profile — the user whose membership was
--    just deleted — and only when that user's active pointer is now invalid.
-- -----------------------------------------------------------------------------
create or replace function public.repair_active_workspace_after_member_removal()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user      uuid := old.user_id;
  v_active    uuid;
  v_has_prof  boolean;
  v_still     boolean;
  v_next      uuid;
  v_next_role text;
begin
  -- The profile may be gone already (e.g. the delete is a cascade from deleting
  -- the auth user). Nothing to repair then.
  select p.active_organization_id, true
    into v_active, v_has_prof
  from public.profiles p
  where p.id = v_user;

  if not v_has_prof then
    return old;
  end if;

  -- Is the CURRENT active pointer still backed by a live membership? If it names
  -- an organization the user still belongs to, leave it strictly alone — removing
  -- one membership must not disturb an unrelated active workspace (Case B).
  if v_active is not null then
    select exists (
      select 1 from public.organization_members m
      where m.user_id = v_user and m.organization_id = v_active
    ) into v_still;

    if v_still then
      return old;
    end if;
  else
    -- A NULL pointer is already valid (resolution falls back on read); only the
    -- caches below might need normalizing, so continue.
    v_still := false;
  end if;

  -- Pointer is NULL or now dangling. Recompute the fallback, exactly as
  -- current_org_id() would: personal workspace, else oldest membership, else NULL.
  select coalesce(
    (select m.organization_id
       from public.organization_members m
       join public.organizations o on o.id = m.organization_id
      where m.user_id = v_user and o.kind = 'personal'
      order by m.created_at, m.id
      limit 1),
    (select m.organization_id
       from public.organization_members m
      where m.user_id = v_user
      order by m.created_at, m.id
      limit 1)
  ) into v_next;

  if v_next is not null then
    select m.role into v_next_role
    from public.organization_members m
    where m.user_id = v_user and m.organization_id = v_next;
  end if;

  update public.profiles
     set active_organization_id = v_next,
         -- Legacy caches, kept in step (never authoritative). role is NOT NULL,
         -- so with no memberships left it becomes the least-privileged 'viewer'.
         organization_id = v_next,
         role = case
                  when v_next_role in ('owner','admin','fleet_manager','viewer')
                    then v_next_role
                  else 'viewer'
                end
   where id = v_user
     and (active_organization_id is distinct from v_next
          or organization_id is distinct from v_next);

  return old;
end;
$$;

comment on function public.repair_active_workspace_after_member_removal() is
  'AFTER DELETE on organization_members: if the removed user''s active_organization_id no longer names a live membership, repair it (personal workspace, else oldest membership, else NULL) and sync the legacy caches. Enforces "active pointer is never a non-member org" for every deletion path, atomically.';

drop trigger if exists organization_members_repair_active_workspace
  on public.organization_members;
create trigger organization_members_repair_active_workspace
  after delete on public.organization_members
  for each row
  execute function public.repair_active_workspace_after_member_removal();

-- -----------------------------------------------------------------------------
-- 2. The authorized operation. One transaction: authorize, delete exactly one
--    membership, return a structured result. The trigger above does the pointer
--    repair. Derives the caller from auth.uid(); never trusts a client user id or
--    organization id — only a membership id, re-checked against the caller's
--    active organization.
--
--    Authorization mirrors org_members_delete_admin exactly, and additionally
--    permits SELF-LEAVE (a member removing their own membership). Self-leave is a
--    safe, expected capability; it is gated by the same last-owner protection and
--    has no UI in this change (see docs).
-- -----------------------------------------------------------------------------
create or replace function public.remove_organization_member(p_member_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller     uuid := auth.uid();
  v_org        uuid;
  v_caller_role text;
  v_target_user uuid;
  v_target_role text;
  v_owner_count int;
  v_new_active  uuid;
begin
  if v_caller is null then
    return jsonb_build_object('state', 'not_authenticated');
  end if;

  -- The organization the caller is acting in, and their role there. Resolved by
  -- the database, so it is always an organization the caller actually belongs to.
  v_org := public.current_org_id();
  if v_org is null then
    return jsonb_build_object('state', 'not_authorized');
  end if;
  v_caller_role := public.current_org_role();

  -- Serialize every membership mutation for this organization against the
  -- last-owner trigger and concurrent removals by locking the parent row, the
  -- same row protect_last_owner() locks.
  perform 1 from public.organizations o where o.id = v_org for update;

  -- The target must be a membership in the caller's OWN active organization. A
  -- member id from another organization simply is not found here.
  select m.user_id, m.role
    into v_target_user, v_target_role
  from public.organization_members m
  where m.id = p_member_id
    and m.organization_id = v_org;

  if v_target_user is null then
    return jsonb_build_object('state', 'not_found');
  end if;

  -- Authorization:
  --   * self-leave  — a member may always remove their own membership; or
  --   * admin/owner — owners remove anyone, admins remove non-owners only.
  if v_target_user <> v_caller then
    if not public.is_org_admin() then
      return jsonb_build_object('state', 'not_authorized');
    end if;
    if v_target_role = 'owner' and v_caller_role <> 'owner' then
      return jsonb_build_object('state', 'not_authorized');
    end if;
  end if;

  -- Last-owner protection: refuse cleanly rather than letting the trigger raise.
  -- (The trigger remains the final word if this were ever bypassed.)
  if v_target_role = 'owner' then
    select count(*) into v_owner_count
    from public.organization_members m
    where m.organization_id = v_org and m.role = 'owner';
    if v_owner_count <= 1 then
      return jsonb_build_object('state', 'last_owner');
    end if;
  end if;

  -- Exactly one row, addressed by primary key within the locked organization.
  -- The organizations-row lock serializes concurrent removals, so by the time a
  -- racing second call reaches its own SELECT above the row is already gone and
  -- it returns 'not_found' — deterministic, and no row is ever deleted twice.
  delete from public.organization_members
  where id = p_member_id and organization_id = v_org;

  if not found then
    -- Defensive: under the lock this should not occur (the SELECT found the row).
    return jsonb_build_object('state', 'not_found');
  end if;

  -- The AFTER DELETE trigger has now repaired the target's pointer. Read it back
  -- for the structured result.
  select p.active_organization_id into v_new_active
  from public.profiles p where p.id = v_target_user;

  return jsonb_build_object(
    'state', 'ok',
    'organization_id', v_org,
    'removed_user_id', v_target_user,
    'was_self_leave', (v_target_user = v_caller),
    'new_active_organization_id', v_new_active
  );
end;
$$;

comment on function public.remove_organization_member(uuid) is
  'Atomically remove one organization membership. Authorizes the caller (admin/owner removes others per the role matrix; any member may self-leave), enforces last-owner protection, deletes exactly one membership addressed by id within the caller''s active organization, and (via the AFTER DELETE trigger) repairs the removed user''s active workspace in the same transaction. Derives the caller from auth.uid(); never trusts a client-supplied user or organization id. Returns { state, ... }.';

-- PostgREST exposure: authenticated only.
revoke all on function public.remove_organization_member(uuid) from public, anon;
grant execute on function public.remove_organization_member(uuid) to authenticated;

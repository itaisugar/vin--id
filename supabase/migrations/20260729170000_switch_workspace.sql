-- =============================================================================
-- Vin.ID multi-workspace — M6: switching workspace
-- =============================================================================
-- Writing profiles.active_organization_id directly would already be safe:
-- profiles RLS is own-row for both select and update, and current_org_id()
-- validates the pointer against a live membership on every read, so even a
-- successfully written bad pointer grants nothing.
--
-- This RPC exists anyway, for two reasons:
--
--   1. It REFUSES rather than silently misbehaving. A direct update to an
--      organization the user does not belong to would succeed at the database
--      level and then resolve to their default workspace — the user would ask
--      for organization B, get organization A, and see no error. Failing at the
--      moment of the request is a better product and a better audit trail.
--
--   2. It gives the switch one name, so the rule "a workspace switch validates
--      membership" lives in the database rather than in whichever caller
--      happens to be doing the writing.
--
-- The user is ALWAYS auth.uid(). There is no user parameter, so no caller can
-- switch anybody else's workspace.
-- =============================================================================

create or replace function public.set_active_organization(p_organization uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_role text;
begin
  if v_user is null then
    return jsonb_build_object('state', 'not_authenticated');
  end if;

  -- NULL clears the preference, which is legitimate: resolution falls back to
  -- the personal workspace, then to the oldest membership.
  if p_organization is null then
    update public.profiles set active_organization_id = null where id = v_user;
    return jsonb_build_object('state', 'ok', 'organization_id', null);
  end if;

  -- The membership check. Note it reads organization_members directly and not
  -- current_org_id(), because we are choosing the organization, not acting in
  -- one — resolving through the helper here would be circular.
  select m.role into v_role
  from public.organization_members m
  where m.user_id = v_user
    and m.organization_id = p_organization;

  if v_role is null then
    -- Deliberately indistinguishable from "no such organization": telling a
    -- caller that an organization exists but is not theirs is an enumeration
    -- oracle. Nothing is written.
    return jsonb_build_object('state', 'not_a_member');
  end if;

  update public.profiles
     set active_organization_id = p_organization,
         -- Keep the legacy cache in step. It grants nothing, but a stale value
         -- in it is confusing to anyone reading the row by hand.
         organization_id        = p_organization,
         role                   = case
                                    when v_role in ('owner','admin','fleet_manager','viewer')
                                    then v_role
                                    -- profiles.role predates the driver role and
                                    -- its CHECK does not allow it. The cache is
                                    -- not authoritative, so the safest value is
                                    -- the least privileged one.
                                    else 'viewer'
                                  end
   where id = v_user;

  return jsonb_build_object('state', 'ok',
                            'organization_id', p_organization,
                            'role', v_role);
end;
$$;

comment on function public.set_active_organization(uuid) is
  'Switch the caller''s active workspace. Verifies membership first and writes nothing if the caller does not belong to the organization. Always acts on auth.uid() — there is no user parameter. Switching changes no ownership, no role and no data.';

revoke all on function public.set_active_organization(uuid) from public, anon;
grant execute on function public.set_active_organization(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- The caller's workspaces, for the selector.
--
-- SECURITY DEFINER because it joins `organizations`, which RLS restricts to the
-- caller's current organization — a plain query would therefore return only the
-- workspace they are already in, which is precisely the one they do not need
-- listed. It returns only workspaces the caller is a MEMBER of; there is no
-- parameter through which another user's list could be requested.
-- -----------------------------------------------------------------------------
create or replace function public.list_my_workspaces()
returns table (
  organization_id uuid,
  name            text,
  kind            text,
  role            text,
  is_active       boolean,
  joined_at       timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select o.id,
         o.name,
         o.kind,
         m.role,
         o.id = public.current_org_id(),
         m.created_at
  from public.organization_members m
  join public.organizations o on o.id = m.organization_id
  where m.user_id = auth.uid()
  -- Personal first, then oldest membership: the same order the selector renders
  -- and the same order current_org_id() falls back through.
  order by (o.kind = 'personal') desc, m.created_at, m.id;
$$;

comment on function public.list_my_workspaces() is
  'Every workspace the caller belongs to, with their role in each and which one is active. Personal first. Takes no arguments — a caller can only ever list their own.';

revoke all on function public.list_my_workspaces() from public, anon;
grant execute on function public.list_my_workspaces() to authenticated;

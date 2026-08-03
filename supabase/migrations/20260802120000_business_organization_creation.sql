-- =============================================================================
-- Vin.ID private-first — explicit Business organization creation + Personal
-- invitation guard
-- =============================================================================
-- Signup is already private-first (handle_new_user creates a kind='personal'
-- workspace and makes it active). What is missing is the OTHER half: a user must
-- be able to EXPLICITLY create a separate Business organization, and a Personal
-- workspace must never be turn-able into a team by inviting someone into it.
--
-- Two changes, both additive to the validated multi-workspace architecture:
--
--   1. create_business_organization(name) — an authenticated RPC that creates a
--      SEPARATE organization with kind='business', an owner membership for the
--      caller, and points their active workspace at it. Atomic. It moves no data:
--      the Personal workspace and every vehicle in it are untouched.
--
--   2. Personal-workspace invitation guard — the invitation INSERT policy now
--      also requires the target organization to be non-personal. A Personal
--      Owner (who is an org admin) could previously create an invitation; that
--      is the only path that could grow a Personal workspace into a shared one,
--      and it is closed here at the database, not just in the UI.
--
-- NOT CHANGED, deliberately:
--   * accept_invitation()'s personal->business promotion stays. With this guard
--     no invitation can be created FOR a personal org, so the promotion line is
--     now unreachable for personal orgs — but it is harmless defense in depth and
--     removing it is a separate, unnecessary risk. (Task B: keep it.)
--   * No existing organization is reclassified, renamed, split or emptied. No
--     membership is added or removed. No vehicle is moved. No backfill runs.
--
-- Idempotent: CREATE OR REPLACE / DROP POLICY IF EXISTS throughout.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. create_business_organization(name)
-- -----------------------------------------------------------------------------
-- SECURITY DEFINER so it can write organizations / organization_members /
-- profiles in one transaction regardless of the caller's RLS. The caller is
-- ALWAYS auth.uid(); there is no owner-user argument, so no caller can create an
-- organization owned by someone else.
--
-- Returns { state, organization_id? }, state in:
--   ok | not_authenticated | no_profile | invalid_name
-- -----------------------------------------------------------------------------
create or replace function public.create_business_organization(p_name text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user     uuid := auth.uid();
  v_email    text;
  v_name     text;
  v_org      uuid;
  v_existing uuid;
begin
  if v_user is null then
    return jsonb_build_object('state', 'not_authenticated');
  end if;

  -- A user with no profile row is in an inconsistent state (the signup trigger
  -- always writes one). Refuse rather than mint an organization for a ghost.
  if not exists (select 1 from public.profiles p where p.id = v_user) then
    return jsonb_build_object('state', 'no_profile');
  end if;

  -- Normalize + validate the name. Trim, reject empty, cap length. Matches the
  -- application-side organizationInputSchema (max 120). Hebrew and English both
  -- pass — length() counts characters, not bytes.
  v_name := btrim(coalesce(p_name, ''));
  if v_name = '' or length(v_name) > 120 then
    return jsonb_build_object('state', 'invalid_name');
  end if;

  -- Retry / double-click safety. If this caller ALREADY OWNS a business
  -- organization with the same normalized name, return it instead of stacking a
  -- duplicate. This is not global uniqueness — two different users may each own a
  -- "Fleet" — it only stops one user's repeated submit from creating copies.
  select o.id into v_existing
  from public.organizations o
  join public.organization_members m on m.organization_id = o.id
  where m.user_id = v_user
    and m.role = 'owner'
    and o.kind = 'business'
    and lower(o.name) = lower(v_name)
  order by o.created_at, o.id
  limit 1;

  if v_existing is not null then
    -- Mirror a fresh create: make it the active workspace, sync the cache.
    update public.profiles
       set active_organization_id = v_existing,
           organization_id        = v_existing,
           role                   = 'owner'
     where id = v_user;
    return jsonb_build_object('state', 'ok',
                              'organization_id', v_existing,
                              'deduplicated', true);
  end if;

  select email into v_email from auth.users where id = v_user;

  -- The new organization is SEPARATE — kind='business'. Nothing about the
  -- Personal workspace or its vehicles is read or written here.
  insert into public.organizations (name, email, kind)
  values (v_name, v_email, 'business')
  returning id into v_org;

  insert into public.organization_members (organization_id, user_id, role)
  values (v_org, v_user, 'owner');

  -- Make the new organization active — it is what the user asked for. Their
  -- Personal workspace is one switch away. The legacy profile cache is kept in
  -- step for any reader that still consults it; it grants nothing either way.
  update public.profiles
     set active_organization_id = v_org,
         organization_id        = v_org,
         role                   = 'owner'
   where id = v_user;

  return jsonb_build_object('state', 'ok', 'organization_id', v_org);
end;
$$;

comment on function public.create_business_organization(text) is
  'Create a SEPARATE business organization (kind=business) owned by auth.uid(), make it the active workspace, and keep the caller''s personal workspace and data untouched. Atomic. No user/owner argument — a caller can only ever create an organization for themselves. Idempotent for a repeated same-name submit by the same owner.';

revoke all on function public.create_business_organization(text) from public, anon;
grant execute on function public.create_business_organization(text) to authenticated;

-- -----------------------------------------------------------------------------
-- 2. Personal-workspace invitation guard (server-side, in RLS)
-- -----------------------------------------------------------------------------
-- Rebuilds the invitation INSERT policy from 20260725190000, PRESERVING the
-- owner/admin + invited_by rules and ADDING the requirement that the target
-- organization is not personal. A Personal Owner therefore cannot create an
-- invitation via the app, a direct PostgREST insert, or any other path — the
-- database refuses the row.
--
-- Existing business organizations have kind='business', so this changes nothing
-- for them.
drop policy if exists "org_invitations_insert_admin" on public.organization_invitations;
create policy "org_invitations_insert_admin" on public.organization_invitations
  for insert with check (
    organization_id = public.current_org_id()
    and public.is_org_admin()
    and invited_by = auth.uid()
    -- The guard: never into a personal workspace.
    and exists (
      select 1 from public.organizations o
      where o.id = organization_id
        and o.kind <> 'personal'
    )
  );

-- =============================================================================
-- End of migration
-- =============================================================================

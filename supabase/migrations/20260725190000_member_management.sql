-- =============================================================================
-- Vin.ID Fleet Lite — member management: owner-vs-admin rules + listing RPC
-- =============================================================================
-- Two gaps left by 20260725140000:
--
--  1. The member policies treated owner and admin identically, so an admin could
--     demote, remove or even mint owners. The product rule is that admins manage
--     everyone EXCEPT owners. Enforced here in RLS so the database is the first
--     line, not just the service layer.
--
--  2. Listing members needs each member's email, which lives in `auth.users` and
--     is not reachable through PostgREST, and their display name, which lives in
--     `profiles` — a deliberately owner-scoped table that same-org colleagues
--     cannot read. Rather than widening `profiles` RLS for everyone, a single
--     SECURITY DEFINER function returns exactly the member list for the caller's
--     own organization.
--
-- Non-destructive and idempotent.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. organization_members RLS — owners manage everyone, admins manage non-owners
-- -----------------------------------------------------------------------------
-- Read: any member of the organization may see who else is in it. Member
-- management is still owner/admin only (below); this only makes the roster
-- readable, which the team screen needs for the "your role" display.
drop policy if exists "org_members_select_same_org" on public.organization_members;
create policy "org_members_select_same_org" on public.organization_members
  for select using (organization_id = public.current_org_id());

-- Insert: admins may add non-owners; only an owner may create another owner.
-- (The normal path is accept_invitation(), which is SECURITY DEFINER and does
-- not consult these policies. This covers direct writes.)
drop policy if exists "org_members_insert_admin" on public.organization_members;
create policy "org_members_insert_admin" on public.organization_members
  for insert with check (
    organization_id = public.current_org_id()
    and public.is_org_admin()
    and (public.current_org_role() = 'owner' or role <> 'owner')
  );

-- Update: an admin may neither touch an existing owner's row nor promote anyone
-- to owner. An owner may do both. The row must stay inside the same org.
drop policy if exists "org_members_update_admin" on public.organization_members;
create policy "org_members_update_admin" on public.organization_members
  for update using (
    organization_id = public.current_org_id()
    and public.is_org_admin()
    and (public.current_org_role() = 'owner' or role <> 'owner')
  ) with check (
    organization_id = public.current_org_id()
    and public.is_org_admin()
    and (public.current_org_role() = 'owner' or role <> 'owner')
  );

-- Delete: same rule — admins cannot remove owners. The last-owner trigger still
-- applies on top of this for owners removing owners.
drop policy if exists "org_members_delete_admin" on public.organization_members;
create policy "org_members_delete_admin" on public.organization_members
  for delete using (
    organization_id = public.current_org_id()
    and public.is_org_admin()
    and (public.current_org_role() = 'owner' or role <> 'owner')
  );

-- -----------------------------------------------------------------------------
-- 2. Member listing (owner/admin only)
-- -----------------------------------------------------------------------------
-- Returns the roster of the CALLER'S organization only. The organization is
-- derived from the caller's membership via current_org_id(); there is no
-- organization parameter, so a client cannot ask about someone else's org.
create or replace function public.list_organization_members()
returns table (
  id         uuid,
  user_id    uuid,
  role       text,
  created_at timestamptz,
  email      text,
  full_name  text
)
language sql
stable
security definer
set search_path = ''
as $$
  select m.id,
         m.user_id,
         m.role,
         m.created_at,
         u.email::text,
         p.full_name
  from public.organization_members m
  join auth.users u on u.id = m.user_id
  left join public.profiles p on p.id = m.user_id
  where m.organization_id = public.current_org_id()
    and public.is_org_admin()
  order by
    case m.role
      when 'owner' then 0
      when 'admin' then 1
      when 'fleet_manager' then 2
      else 3
    end,
    m.created_at;
$$;

comment on function public.list_organization_members() is
  'Roster of the caller''s own organization (owner/admin only). Takes no organization argument: the org comes from the caller''s membership. Returns no password, token or security column.';

revoke all on function public.list_organization_members() from public, anon;
grant execute on function public.list_organization_members() to authenticated;

-- =============================================================================
-- End of migration
-- =============================================================================

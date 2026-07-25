-- =============================================================================
-- Vin.ID Fleet Lite — let an invited EXISTING user actually join
-- =============================================================================
-- `handle_new_user` gives every signup its own organization and an owner
-- membership. Combined with the one-active-organization constraint
-- (UNIQUE(user_id) on organization_members), the first version of
-- accept_invitation returned 'already_member' for *every* existing account:
-- nobody could ever accept an invitation. Verified at runtime before this fix.
--
-- Resolution, still under the one-org constraint (multi-org switching is out of
-- scope): accepting an invitation replaces the invitee's auto-created PERSONAL
-- organization, and only that. The personal org is identified structurally, not
-- by a flag:
--
--   * the invitee is its only member, and
--   * it has no pending invitations, and
--   * it holds no fleet data.
--
-- The last condition is enforced by the database rather than by a checklist:
-- every organization-scoped table (vehicles, documents, reminders, ...) keeps a
-- RESTRICT foreign key to organizations, so the DELETE below simply fails with
-- foreign_key_violation if anything is attached. That failure is caught and the
-- acceptance is refused, so an organization holding real data is never
-- destroyed by accepting an invitation.
--
-- Anything else (an org with colleagues, invitations or vehicles) still yields
-- 'already_member': the user must be removed from it deliberately first.
--
-- Non-destructive and idempotent.
-- =============================================================================

create or replace function public.accept_invitation(p_token_hash text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user      uuid := auth.uid();
  v_email     text;
  v_inv       public.organization_invitations%rowtype;
  v_existing  uuid;
  v_others    integer;
  v_pending   integer;
begin
  if v_user is null then
    return jsonb_build_object('state', 'not_authenticated');
  end if;

  select email into v_email from auth.users where id = v_user;

  -- Lock the invitation row so concurrent accepts serialize; the first wins and
  -- the rest observe status = 'accepted'.
  select * into v_inv
  from public.organization_invitations
  where token_hash = p_token_hash
  for update;

  if not found then
    return jsonb_build_object('state', 'invalid');
  end if;
  if v_inv.status = 'revoked' then
    return jsonb_build_object('state', 'revoked');
  end if;
  if v_inv.status = 'accepted' then
    return jsonb_build_object('state', 'accepted');
  end if;
  if v_inv.status = 'expired' or v_inv.expires_at < now() then
    return jsonb_build_object('state', 'expired');
  end if;

  -- The invited address must match the authenticated account (case-insensitive).
  if v_email is null or lower(v_email) <> lower(v_inv.email) then
    return jsonb_build_object('state', 'email_mismatch');
  end if;

  select organization_id into v_existing
  from public.organization_members
  where user_id = v_user;

  if v_existing = v_inv.organization_id then
    -- Already a member of the inviting org: consume the invitation, report ok.
    update public.organization_invitations
      set status = 'accepted', accepted_at = now(), accepted_by = v_user
      where id = v_inv.id;
    return jsonb_build_object('state', 'ok', 'organization_id', v_inv.organization_id);
  end if;

  if v_existing is not null then
    -- Only a disposable personal organization may be replaced.
    select count(*) into v_others
    from public.organization_members
    where organization_id = v_existing and user_id <> v_user;

    if v_others > 0 then
      return jsonb_build_object('state', 'already_member');
    end if;

    select count(*) into v_pending
    from public.organization_invitations
    where organization_id = v_existing and status = 'pending';

    if v_pending > 0 then
      return jsonb_build_object('state', 'already_member');
    end if;

    -- Cascades this user's membership away. A RESTRICT foreign key from any
    -- organization-scoped table (i.e. the org actually holds fleet data) aborts
    -- the delete, and the invitation is refused instead.
    begin
      delete from public.organizations where id = v_existing;
    exception when foreign_key_violation then
      return jsonb_build_object('state', 'already_member');
    end;
  end if;

  -- Create the membership with the invited role.
  insert into public.organization_members (organization_id, user_id, role)
  values (v_inv.organization_id, v_user, v_inv.role);

  -- Keep the profile "current org" cache in step with membership.
  update public.profiles
    set organization_id = v_inv.organization_id, role = v_inv.role
    where id = v_user;

  -- Consume the invitation.
  update public.organization_invitations
    set status = 'accepted', accepted_at = now(), accepted_by = v_user
    where id = v_inv.id;

  return jsonb_build_object('state', 'ok', 'organization_id', v_inv.organization_id);
end;
$$;

comment on function public.accept_invitation(text) is
  'Atomic invitation acceptance. Verifies token/status/expiry/email, replaces the invitee''s empty auto-created personal organization, creates the membership, consumes the invitation and syncs the profile cache. Derives the user from auth.uid(); never trusts a client-supplied organization or user id.';

grant execute on function public.accept_invitation(text) to authenticated;

-- =============================================================================
-- End of migration
-- =============================================================================

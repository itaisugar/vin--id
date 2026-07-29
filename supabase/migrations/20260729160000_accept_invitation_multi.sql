-- =============================================================================
-- Vin.ID multi-workspace — M5: joining an organization ADDS a membership
-- =============================================================================
-- WHAT WAS WRONG. Under UNIQUE(user_id) a user could hold only one membership,
-- so accept_invitation() made room by DELETING the invitee's auto-created
-- personal organization. It refused to do so when that organization held any
-- data — enforced by the RESTRICT foreign keys, whose foreign_key_violation was
-- caught and reported as 'already_member'.
--
-- The result in production: every real user was refused. Reproduced before this
-- fix, on a clean database:
--
--     accept_invitation, invitee owns 1 vehicle  -> {"state": "already_member"}
--     accept_invitation, invitee owns nothing    -> {"state": "ok"}
--
-- The message was also wrong — the user was not a member of the inviting
-- organization at all.
--
-- WHAT IT DOES NOW. Adds a membership. It deletes nothing, moves nothing and
-- copies nothing: the personal workspace and every vehicle in it survive
-- untouched, and the user ends up belonging to both. Joining a second and a
-- third organization works the same way.
--
-- UNCHANGED, deliberately: the decision order, the email match, the
-- inviter-selected role, explicit acceptance, and the fact that the accepting
-- user is derived from auth.uid() rather than from any argument.
-- =============================================================================

create or replace function public.accept_invitation(p_token_hash text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user  uuid := auth.uid();
  v_email text;
  v_inv   public.organization_invitations%rowtype;
begin
  if v_user is null then
    return jsonb_build_object('state', 'not_authenticated');
  end if;

  select email into v_email from auth.users where id = v_user;

  -- Lock the invitation so concurrent accepts serialize: the first wins and the
  -- rest observe status = 'accepted'.
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

  -- The invited address must match the authenticated account.
  if v_email is null or lower(v_email) <> lower(v_inv.email) then
    return jsonb_build_object('state', 'email_mismatch');
  end if;

  -- Already in THIS organization — note the change of meaning. It used to mean
  -- "already a member of something", which is why a user with a personal
  -- workspace could never join anything. Consume the invitation and report ok,
  -- so a double click is idempotent rather than an error.
  if exists (
    select 1 from public.organization_members m
    where m.user_id = v_user
      and m.organization_id = v_inv.organization_id
  ) then
    update public.organization_invitations
      set status = 'accepted', accepted_at = now(), accepted_by = v_user
      where id = v_inv.id;
    return jsonb_build_object('state', 'ok',
                              'organization_id', v_inv.organization_id);
  end if;

  -- ADD the membership. No organization is deleted and no row is moved: the
  -- invitee keeps their personal workspace, their vehicles and every other
  -- organization they belong to.
  --
  -- The role is the INVITER'S choice, taken from the invitation row. It is
  -- never read from a client argument, and organization_invitations.role
  -- excludes 'owner' at the CHECK level, so an invitation cannot mint an owner.
  --
  -- ON CONFLICT guards the race the row lock above does not: two different
  -- invitations to the same organization, accepted concurrently.
  insert into public.organization_members (organization_id, user_id, role)
  values (v_inv.organization_id, v_user, v_inv.role)
  on conflict (organization_id, user_id) do nothing;

  -- A personal workspace has exactly ONE member, by definition. The moment
  -- somebody else joins it, it is a shared workspace and calling it "Personal"
  -- in the UI would be a lie — the invitee would see another person's private
  -- vehicles under a label claiming they were their own.
  --
  -- This is the only path that can add a member to an existing organization, so
  -- it is the only place the invariant can be broken, and therefore the right
  -- place to maintain it. Promotion is one-way: an organization never becomes
  -- personal again, even if the extra members later leave, because its name and
  -- its data no longer belong to one person by assumption.
  update public.organizations
     set kind = 'business'
   where id = v_inv.organization_id
     and kind = 'personal';

  -- Make the organization they just joined the active one — it is what they
  -- asked for by accepting. Their personal workspace is one switch away. The
  -- legacy profile cache is kept in step for any reader that still consults it;
  -- it grants nothing either way.
  update public.profiles
     set active_organization_id = v_inv.organization_id,
         organization_id        = v_inv.organization_id,
         role                   = v_inv.role
   where id = v_user;

  update public.organization_invitations
    set status = 'accepted', accepted_at = now(), accepted_by = v_user
    where id = v_inv.id;

  return jsonb_build_object('state', 'ok',
                            'organization_id', v_inv.organization_id);
end;
$$;

comment on function public.accept_invitation(text) is
  'Atomic invitation acceptance. Verifies token/status/expiry/email, then ADDS a membership with the inviter-selected role — the invitee keeps their personal workspace and every other organization. Idempotent: replay returns ok without creating a second membership. Derives the user from auth.uid(); never trusts a client-supplied organization, user id or role.';

revoke all on function public.accept_invitation(text) from public, anon;
grant execute on function public.accept_invitation(text) to authenticated;

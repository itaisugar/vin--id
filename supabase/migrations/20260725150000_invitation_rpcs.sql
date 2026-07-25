-- =============================================================================
-- Vin.ID Fleet Lite — invitation preview + acceptance RPCs
-- =============================================================================
-- SECURITY DEFINER RPCs, mirroring the passport RPC pattern:
--   * get_invitation_preview(hash)  — read-only; returns the MINIMUM needed to
--     decide whether to accept. Never creates membership. Grant anon+auth so the
--     acceptance page can render before/after login.
--   * accept_invitation(hash)       — atomic; authenticated only. Verifies token
--     validity, email match and the one-org constraint, then creates the
--     membership, marks the invitation used and syncs the profile cache — all in
--     one transaction, so a partial acceptance is impossible and concurrent
--     attempts create at most one membership.
--
-- Tokens are looked up by their sha256 hash (the raw token is never stored). The
-- token hash is never returned to the client.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Preview: minimal, safe, read-only. Distinguishes the invitation states
-- without leaking org data, member lists, or the token hash. The invited email
-- is returned MASKED (e.g. j***@example.com) so the recipient can confirm which
-- address to use without exposing the full address to a token holder.
-- -----------------------------------------------------------------------------
create or replace function public.get_invitation_preview(p_token_hash text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_inv  public.organization_invitations%rowtype;
  v_org  public.organizations%rowtype;
  v_local text;
  v_domain text;
  v_masked text;
begin
  select * into v_inv
  from public.organization_invitations
  where token_hash = p_token_hash;

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

  select * into v_org from public.organizations where id = v_inv.organization_id;
  if not found then
    return jsonb_build_object('state', 'invalid');
  end if;

  -- Mask the email: first char + *** + domain.
  v_local  := split_part(v_inv.email, '@', 1);
  v_domain := split_part(v_inv.email, '@', 2);
  v_masked := left(v_local, 1) || '***' || case when v_domain <> '' then '@' || v_domain else '' end;

  return jsonb_build_object(
    'state', 'valid',
    'organization_name', v_org.name,
    'role', v_inv.role,
    'email_masked', v_masked,
    'expires_at', v_inv.expires_at
  );
end;
$$;

comment on function public.get_invitation_preview(text) is
  'Read-only, minimal invitation preview. Never creates membership; never returns the token hash or org data beyond the display name.';

-- -----------------------------------------------------------------------------
-- Accept: atomic. Derives the buyer/member from auth.uid() (never the client);
-- validates the token, email match and one-org constraint; then creates the
-- membership, marks the invitation accepted, and syncs the profile cache.
--
-- Returns { state, organization_id? }, state in:
--   ok | not_authenticated | invalid | revoked | accepted | expired |
--   email_mismatch | already_member
-- -----------------------------------------------------------------------------
create or replace function public.accept_invitation(p_token_hash text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user   uuid := auth.uid();
  v_email  text;
  v_inv    public.organization_invitations%rowtype;
  v_existing uuid;
begin
  if v_user is null then
    return jsonb_build_object('state', 'not_authenticated');
  end if;

  select email into v_email from auth.users where id = v_user;

  -- Lock the invitation row so concurrent accepts serialize; the first wins and
  -- the rest see status = 'accepted'.
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

  -- Email must match the invited address (case-insensitive).
  if v_email is null or lower(v_email) <> lower(v_inv.email) then
    return jsonb_build_object('state', 'email_mismatch');
  end if;

  -- One active organization per user (bootcamp constraint). If the user already
  -- belongs to the SAME org, treat as success (idempotent); otherwise reject.
  select organization_id into v_existing
  from public.organization_members
  where user_id = v_user;

  if v_existing is not null then
    if v_existing = v_inv.organization_id then
      -- Already a member of this org: consume the invitation, report ok.
      update public.organization_invitations
        set status = 'accepted', accepted_at = now(), accepted_by = v_user
        where id = v_inv.id;
      return jsonb_build_object('state', 'ok', 'organization_id', v_inv.organization_id);
    end if;
    return jsonb_build_object('state', 'already_member');
  end if;

  -- Create the membership with the invited role.
  insert into public.organization_members (organization_id, user_id, role)
  values (v_inv.organization_id, v_user, v_inv.role);

  -- Sync the profile "current org" cache (kept in step with membership).
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
  'Atomic invitation acceptance. Verifies token/email/one-org, creates membership, consumes the invitation, syncs the profile cache. Derives the user from auth.uid().';

grant execute on function public.get_invitation_preview(text) to anon, authenticated;
grant execute on function public.accept_invitation(text)      to authenticated;

-- =============================================================================
-- End of migration
-- =============================================================================

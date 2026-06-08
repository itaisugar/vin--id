-- =============================================================================
-- Vin.ID — Phase 3B: public Vehicle Passport preview RPC
-- =============================================================================
-- Serves the public /p/[token] preview WITHOUT exposing raw tables and WITHOUT
-- a service-role key:
--
--   * The raw tables (transfer_tokens, vehicle_passports) keep their owner-only
--     RLS — NO public/anon SELECT policies are added.
--   * A SECURITY DEFINER function validates a token hash and returns ONLY
--     curated, safe snapshot data (never owner ids, storage paths, public_id,
--     server_signature, or the token hash itself).
--   * Viewing is strictly read-only: the function NEVER updates token status,
--     used_at, or passport status.
--
-- The Next.js server hashes the raw token (same sha256 as creation) and calls
-- this function via RPC using the anon client. The browser never calls it
-- directly and never touches the raw tables.
--
-- Returns a jsonb envelope: { state, passport? } where state is one of:
--   ok | not_found | expired | token_revoked | passport_revoked | accepted | invalid
-- =============================================================================

create or replace function public.get_public_passport(p_token_hash text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token   public.transfer_tokens%rowtype;
  v_passport public.vehicle_passports%rowtype;
begin
  -- 1. Look up the token by hash (read-only).
  select * into v_token
  from public.transfer_tokens
  where token_hash = p_token_hash;

  if not found then
    return jsonb_build_object('state', 'not_found');
  end if;

  -- 2. Token lifecycle (no mutation).
  if v_token.status = 'revoked' then
    return jsonb_build_object('state', 'token_revoked');
  end if;
  if v_token.status = 'used' then
    -- Reserved for the future Accept action.
    return jsonb_build_object('state', 'accepted');
  end if;
  if v_token.status = 'expired'
     or (v_token.expires_at is not null and v_token.expires_at < now()) then
    return jsonb_build_object('state', 'expired');
  end if;
  -- token.status is 'active' beyond this point

  -- 3. Load the related passport.
  select * into v_passport
  from public.vehicle_passports
  where id = v_token.passport_id
    and deleted_at is null;

  if not found then
    return jsonb_build_object('state', 'not_found');
  end if;

  if v_passport.status = 'revoked' then
    return jsonb_build_object('state', 'passport_revoked');
  end if;
  if v_passport.status = 'accepted' then
    return jsonb_build_object('state', 'accepted');
  end if;
  if v_passport.status <> 'active' then
    return jsonb_build_object('state', 'invalid');
  end if;
  if v_passport.expires_at is not null and v_passport.expires_at < now() then
    return jsonb_build_object('state', 'expired');
  end if;
  if v_passport.snapshot is null or v_passport.snapshot = '{}'::jsonb then
    return jsonb_build_object('state', 'invalid');
  end if;

  -- 4. Return ONLY safe, curated fields. The issuer user id is stripped from
  --    the snapshot meta so the owner's id never leaves the database.
  return jsonb_build_object(
    'state', 'ok',
    'passport', jsonb_build_object(
      'status', v_passport.status,
      'issued_at', v_passport.issued_at,
      'expires_at', v_passport.expires_at,
      'snapshot_hash', v_passport.snapshot_hash,
      'record_confidence_score', v_passport.record_confidence_score,
      'snapshot', v_passport.snapshot #- '{meta,issuer_user_id}',
      'ai_summary', v_passport.ai_summary
    )
  );
end;
$$;

-- Public preview is callable by anonymous and authenticated visitors. The
-- function body runs as its owner (definer) and only returns curated data.
grant usage on schema public to anon;
revoke all on function public.get_public_passport(text) from public;
grant execute on function public.get_public_passport(text) to anon, authenticated;

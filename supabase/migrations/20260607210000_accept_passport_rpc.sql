-- =============================================================================
-- Vin.ID — Phase 3C: accept Vehicle Passport / ownership transfer (atomic)
-- =============================================================================
-- A logged-in BUYER accepts a valid passport. This must:
--   * copy data into the buyer's account FROM snapshot ONLY (never the seller's
--     live rows),
--   * mark the token used, the passport accepted, and the seller's vehicle sold,
--   * record an ownership_transfers row,
-- all ATOMICALLY (a plpgsql function runs in a single transaction — any failure
-- rolls everything back, so the token is never "used" unless the copy fully
-- succeeds and the seller's vehicle is never sold before the buyer copy lands).
--
-- Why a SECURITY DEFINER function (not the buyer's client):
--   * The buyer cannot update the SELLER's token/passport/vehicle under RLS, and
--     cannot insert ownership_transfers (insert policy requires from_user_id =
--     auth.uid() = the seller). There is no service-role key in the app.
--   * The function runs as its owner (definer), derives the buyer from auth.uid()
--     INSIDE the function (never trusts the client), and only ever reads the
--     passport snapshot for copied data.
--
-- Storage: document FILES are NOT copied (storage_path stays NULL). No storage
-- path is ever read or written here.
-- TODO(copy-document-files): securely copy document files to the buyer later.
--
-- Returns jsonb: { state, new_vehicle_id? } where state is one of:
--   ok | not_authenticated | not_found | expired | token_revoked |
--   passport_revoked | accepted | own_passport | invalid
-- =============================================================================

create or replace function public.accept_passport(p_token_hash text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_buyer     uuid := auth.uid();
  v_token     public.transfer_tokens%rowtype;
  v_passport  public.vehicle_passports%rowtype;
  v_snapshot  jsonb;
  v_vehicle   jsonb;
  v_new_vehicle uuid;
begin
  if v_buyer is null then
    return jsonb_build_object('state', 'not_authenticated');
  end if;

  -- 1. Validate token (no mutation yet).
  select * into v_token from public.transfer_tokens where token_hash = p_token_hash;
  if not found then
    return jsonb_build_object('state', 'not_found');
  end if;
  if v_token.status = 'revoked' then
    return jsonb_build_object('state', 'token_revoked');
  end if;
  if v_token.status = 'used' then
    return jsonb_build_object('state', 'accepted');
  end if;
  if v_token.status = 'expired'
     or (v_token.expires_at is not null and v_token.expires_at < now()) then
    return jsonb_build_object('state', 'expired');
  end if;

  -- 2. Validate passport.
  select * into v_passport from public.vehicle_passports
    where id = v_token.passport_id and deleted_at is null;
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

  -- 3. The owner cannot accept their own passport.
  if v_passport.owner_user_id = v_buyer then
    return jsonb_build_object('state', 'own_passport');
  end if;

  v_snapshot := v_passport.snapshot;
  v_vehicle := v_snapshot->'vehicle';

  -- 4. New vehicle for the buyer (from snapshot only; photo_url stays null).
  insert into public.vehicles
    (owner_user_id, make, model, year, vin, license_plate,
     current_mileage, mileage_unit, photo_url, status)
  values
    (v_buyer,
     nullif(v_vehicle->>'make', ''),
     nullif(v_vehicle->>'model', ''),
     (v_vehicle->>'year')::int,
     nullif(v_vehicle->>'vin', ''),
     nullif(v_vehicle->>'license_plate', ''),
     (v_vehicle->>'current_mileage')::int,
     coalesce(nullif(v_vehicle->>'mileage_unit', ''), 'km'),
     null,
     'active')
  returning id into v_new_vehicle;

  -- 5. Maintenance (snapshot only contains non-deleted records).
  insert into public.maintenance_logs
    (owner_user_id, vehicle_id, performed_at, mileage, service_type,
     description, cost, currency, trust_label, source_type)
  select v_buyer, v_new_vehicle, nullif(m.date, '')::date, m.mileage, m.category,
         m.description, m.cost, coalesce(nullif(m.currency, ''), 'ILS'),
         coalesce(nullif(m.trust_level, ''), 'user_entered'),
         coalesce(nullif(m.source_type, ''), 'user')
  from jsonb_to_recordset(coalesce(v_snapshot->'maintenance', '[]'::jsonb))
    as m(date text, mileage int, category text, description text, cost numeric,
         currency text, trust_level text, source_type text);

  -- 6. Issues.
  insert into public.issue_logs
    (owner_user_id, vehicle_id, reported_at, mileage, title, status, severity,
     resolution_notes, trust_label, source_type)
  select v_buyer, v_new_vehicle, nullif(i.date, '')::date, i.mileage,
         coalesce(nullif(i.symptoms, ''), '—'),
         coalesce(nullif(i.status, ''), 'open'),
         coalesce(nullif(i.severity, ''), 'monitor'),
         i.resolution_notes,
         coalesce(nullif(i.trust_level, ''), 'user_entered'),
         coalesce(nullif(i.source_type, ''), 'user')
  from jsonb_to_recordset(coalesce(v_snapshot->'issues', '[]'::jsonb))
    as i(date text, mileage int, symptoms text, status text, severity text,
         resolution_notes text, trust_level text, source_type text);

  -- 7. Documents — METADATA ONLY. storage_path stays NULL (no file copy).
  insert into public.vehicle_documents
    (owner_user_id, vehicle_id, doc_type, file_name, mime_type, storage_path,
     document_date, expiry_date, vendor, amount, currency,
     contains_personal_info, share_allowed, trust_label)
  select v_buyer, v_new_vehicle,
         coalesce(nullif(d.document_type, ''), 'other'),
         d.file_name, d.mime_type, null,
         nullif(d.document_date, '')::date, nullif(d.expiry_date, '')::date,
         d.vendor, d.amount, coalesce(nullif(d.currency, ''), 'ILS'),
         coalesce(d.contains_personal_info, true),
         coalesce(d.share_allowed, false),
         coalesce(nullif(d.trust_level, ''), 'document_backed')
  from jsonb_to_recordset(coalesce(v_snapshot->'documents', '[]'::jsonb))
    as d(document_type text, file_name text, mime_type text, document_date text,
         expiry_date text, vendor text, amount numeric, currency text,
         contains_personal_info boolean, share_allowed boolean, trust_level text);

  -- 8. Reminders.
  insert into public.reminders
    (owner_user_id, vehicle_id, title, description, reminder_type,
     due_date, due_mileage, urgency, status)
  select v_buyer, v_new_vehicle, coalesce(nullif(r.title, ''), '—'),
         r.description, coalesce(nullif(r.reminder_type, ''), 'custom'),
         nullif(r.due_date, '')::date, r.due_mileage,
         coalesce(nullif(r.urgency, ''), 'green'),
         coalesce(nullif(r.status, ''), 'pending')
  from jsonb_to_recordset(coalesce(v_snapshot->'reminders', '[]'::jsonb))
    as r(title text, description text, reminder_type text, due_date text,
         due_mileage int, urgency text, status text);

  -- 9. Mark token used (one-time) — ONLY on accept.
  update public.transfer_tokens
    set status = 'used', used_at = now(), used_by_user_id = v_buyer
    where id = v_token.id;

  -- 10. Mark passport accepted.
  update public.vehicle_passports
    set status = 'accepted', accepted_at = now(), accepted_by_user_id = v_buyer
    where id = v_passport.id;

  -- 11. Seller's original vehicle becomes sold (kept, never deleted).
  update public.vehicles
    set status = 'sold', sold_at = now()
    where id = v_passport.vehicle_id
      and owner_user_id = v_passport.owner_user_id;

  -- 12. Record the completed ownership transfer.
  insert into public.ownership_transfers
    (from_user_id, to_user_id, vehicle_id, passport_id, transfer_token_id,
     new_vehicle_id, status, accepted_at, completed_at)
  values
    (v_passport.owner_user_id, v_buyer, v_passport.vehicle_id, v_passport.id,
     v_token.id, v_new_vehicle, 'completed', now(), now());

  return jsonb_build_object('state', 'ok', 'new_vehicle_id', v_new_vehicle);
end;
$$;

-- Accept requires a logged-in user. Anonymous visitors cannot call it.
revoke all on function public.accept_passport(text) from public;
grant execute on function public.accept_passport(text) to authenticated;

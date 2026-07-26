-- Private Vehicle release gate — `confirm_fleet_intake()` must refuse a FAILED
-- extraction.
--
-- Found by scripts/validation/private-vehicle-check.mjs, which confirmed an
-- extraction whose status was 'failed' and got a real maintenance record back.
--
-- The function already refused 'cancelled' and 'superseded' for the same
-- reason — a review that is no longer live must not be resurrected — but
-- 'failed' was omitted. A failed extraction is the one state where the database
-- holds NO reading of the document at all (`extracted_data` is `{}` and the
-- screen offers a retry rather than a review), so confirming one would create an
-- operational record whose entire content came from the request body. That
-- defeats the point of routing every write through this function.
--
-- Nothing else about the function changes: this is the shipped definition with
-- one status added to the existing guard list.

CREATE OR REPLACE FUNCTION public.confirm_fleet_intake(p_extraction uuid, p_vehicle uuid, p_category text, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_org      uuid := public.current_org_id();
  v_actor    uuid := auth.uid();
  v_ex       public.document_extractions%rowtype;
  v_owner    uuid;
  v_doc      uuid;
  v_record   uuid;
  v_mileage  integer;
  v_cost     numeric;
  v_perf     date;
  v_start    date;
  v_end      date;
  v_next_d   date;
  v_next_km  integer;
  v_latest   date;
begin
  if v_actor is null then
    return jsonb_build_object('state', 'not_authenticated');
  end if;
  -- Viewer and driver are both excluded here: is_org_writer() is
  -- owner/admin/fleet_manager only.
  if not public.is_org_writer() then
    return jsonb_build_object('state', 'not_authorized');
  end if;

  -- Lock the extraction. Everything after this point is serialized per
  -- extraction, which is what makes double-confirm and concurrent confirm safe.
  select * into v_ex
  from public.document_extractions
  where id = p_extraction and organization_id = v_org
  for update;

  if not found then
    return jsonb_build_object('state', 'extraction_not_found');
  end if;

  -- IDEMPOTENCY: already confirmed → hand back what was created before.
  if v_ex.status = 'confirmed' then
    return jsonb_build_object(
      'state', 'already_confirmed',
      'record_type', v_ex.created_record_type,
      'record_id', v_ex.created_record_id
    );
  end if;

  -- A review that is no longer live must not be resurrected by a late request.
  --
  -- 'failed' joins this list in 20260726170000. A failed extraction has no
  -- readable content: `extracted_data` is empty and the user was shown a retry,
  -- not a review. Accepting a confirmation for one would let a caller mint an
  -- operational record out of a payload the database never saw a document for,
  -- which is precisely what this function exists to prevent.
  if v_ex.status in ('cancelled', 'superseded', 'failed') then
    return jsonb_build_object('state', 'stale');
  end if;

  if p_category is null or p_category not in
     ('maintenance', 'insurance', 'registration', 'inspection') then
    return jsonb_build_object('state', 'invalid_category');
  end if;

  -- Re-resolve the vehicle server-side. The client may propose one, but this
  -- is what decides: it must live in the caller's organization and be alive.
  if p_vehicle is null or not exists (
    select 1 from public.vehicles v
    where v.id = p_vehicle
      and v.organization_id = v_org
      and v.deleted_at is null
  ) then
    return jsonb_build_object('state', 'vehicle_not_found');
  end if;

  -- created_by/original-owner semantics; authorization never reads this.
  v_owner := coalesce(v_ex.owner_user_id, v_actor);
  v_doc := v_ex.document_id;

  -- Dashboard intake: the file has been in Storage since upload but was never
  -- filed as a document, because until this moment nobody knew which vehicle it
  -- belonged to. Create it now, inside the same transaction as the operational
  -- record, so the two can never exist without each other.
  if v_doc is null then
    insert into public.vehicle_documents (
      owner_user_id, organization_id, vehicle_id, doc_type,
      storage_path, file_name, mime_type, file_size, content_hash,
      document_date, trust_label,
      -- Privacy defaults follow the documents module: scans routinely contain
      -- personal information, and sharing is never enabled automatically.
      contains_personal_info, share_allowed
    ) values (
      v_owner, v_org, p_vehicle,
      case p_category
        when 'maintenance'  then 'invoice'
        when 'insurance'    then 'insurance'
        when 'registration' then 'registration'
        else 'inspection'
      end,
      v_ex.pending_storage_path, v_ex.pending_file_name,
      v_ex.pending_mime_type, v_ex.pending_file_size, v_ex.content_hash,
      coalesce(v_perf, v_start), 'ai_extracted',
      true, false
    ) returning id into v_doc;
  end if;

  v_mileage := nullif(p_payload->>'mileage', '')::integer;
  v_cost    := nullif(p_payload->>'cost', '')::numeric;
  v_perf    := nullif(p_payload->>'performed_at', '')::date;
  v_start   := nullif(p_payload->>'start_date', '')::date;
  v_end     := nullif(p_payload->>'end_date', '')::date;
  v_next_d  := nullif(p_payload->>'next_service_date', '')::date;
  v_next_km := nullif(p_payload->>'next_service_km', '')::integer;

  if v_cost is not null and v_cost < 0 then
    return jsonb_build_object('state', 'invalid_payload', 'field', 'cost');
  end if;
  if v_mileage is not null and v_mileage < 0 then
    return jsonb_build_object('state', 'invalid_payload', 'field', 'mileage');
  end if;

  -- ---------------------------------------------------------------------
  -- Create exactly one operational record, linked to the source document.
  -- trust_label is forced to 'ai_extracted' and source_type to
  -- 'fleet_intake' server-side; the client cannot claim a stronger label.
  -- ---------------------------------------------------------------------
  if p_category = 'maintenance' then
    insert into public.maintenance_logs (
      owner_user_id, organization_id, vehicle_id, service_type, description,
      performed_at, mileage, cost, currency, vendor_name,
      trust_label, source_type, document_id
    ) values (
      v_owner, v_org, p_vehicle,
      nullif(btrim(coalesce(p_payload->>'service_type', '')), ''),
      nullif(btrim(coalesce(p_payload->>'description', '')), ''),
      v_perf, v_mileage, v_cost,
      coalesce(nullif(p_payload->>'currency', ''), 'ILS'),
      nullif(btrim(coalesce(p_payload->>'vendor_name', '')), ''),
      'ai_extracted', 'fleet_intake', v_doc
    ) returning id into v_record;

  elsif p_category = 'insurance' then
    insert into public.vehicle_insurance (
      owner_user_id, organization_id, vehicle_id, insurer_name,
      start_date, end_date, cost, insurance_type,
      trust_label, source_type, document_id
    ) values (
      v_owner, v_org, p_vehicle,
      nullif(btrim(coalesce(p_payload->>'insurer_name', '')), ''),
      v_start, v_end, v_cost,
      nullif(btrim(coalesce(p_payload->>'insurance_type', '')), ''),
      'ai_extracted', 'fleet_intake', v_doc
    ) returning id into v_record;

  elsif p_category = 'registration' then
    insert into public.vehicle_registration (
      owner_user_id, organization_id, vehicle_id,
      start_date, end_date, mileage, notes,
      trust_label, source_type, document_id
    ) values (
      v_owner, v_org, p_vehicle, v_start, v_end, v_mileage,
      nullif(btrim(coalesce(p_payload->>'notes', '')), ''),
      'ai_extracted', 'fleet_intake', v_doc
    ) returning id into v_record;

  else -- inspection
    insert into public.vehicle_inspection (
      owner_user_id, organization_id, vehicle_id,
      start_date, end_date, mileage, cost, notes,
      trust_label, source_type, document_id
    ) values (
      v_owner, v_org, p_vehicle, v_start, v_end, v_mileage, v_cost,
      nullif(btrim(coalesce(p_payload->>'notes', '')), ''),
      'ai_extracted', 'fleet_intake', v_doc
    ) returning id into v_record;
  end if;

  -- ---------------------------------------------------------------------
  -- Derived vehicle fields. Every rule here is monotonic and deterministic.
  --
  -- MILEAGE is upward-only: an odometer cannot fall, so an older invoice
  -- surfacing late must never reduce the vehicle's current reading. greatest()
  -- with a null-safe coalesce does this in one statement.
  --
  -- EXPIRY CACHES are forward-only for the same reason in the other
  -- direction: confirming a 2024 insurance certificate after the 2026 one is
  -- already recorded must not drag the cache backwards and invent an alert.
  -- ---------------------------------------------------------------------
  if v_mileage is not null then
    update public.vehicles
       set current_mileage = greatest(coalesce(current_mileage, 0), v_mileage)
     where id = p_vehicle and organization_id = v_org;
  end if;

  if p_category = 'insurance' and v_end is not null then
    update public.vehicles
       set insurance_expiry_date = greatest(coalesce(insurance_expiry_date, v_end), v_end)
     where id = p_vehicle and organization_id = v_org;
  end if;

  if p_category = 'inspection' and v_end is not null then
    update public.vehicles
       set test_expiry_date = greatest(coalesce(test_expiry_date, v_end), v_end)
     where id = p_vehicle and organization_id = v_org;
  end if;

  -- NEXT SERVICE is not monotonic: a service performed today legitimately moves
  -- the next one EARLIER or later. So it is applied only when this really is the
  -- vehicle's newest service — otherwise a late-arriving old invoice would
  -- reschedule the fleet from stale information.
  if p_category = 'maintenance' and (v_next_d is not null or v_next_km is not null) then
    select max(performed_at) into v_latest
    from public.maintenance_logs
    where vehicle_id = p_vehicle and organization_id = v_org
      and deleted_at is null and id <> v_record;

    if v_latest is null or v_perf is null or v_perf >= v_latest then
      update public.vehicles
         set next_service_date = coalesce(v_next_d, next_service_date),
             next_service_km   = coalesce(v_next_km, next_service_km)
       where id = p_vehicle and organization_id = v_org;
    end if;
  end if;

  -- ---------------------------------------------------------------------
  -- Close the loop: the document points at the vehicle it was confirmed
  -- against, and the extraction records who confirmed what, when.
  -- extracted_data is deliberately untouched.
  -- ---------------------------------------------------------------------
  update public.vehicle_documents
     set vehicle_id = p_vehicle
   where id = v_doc and organization_id = v_org and deleted_at is null;

  update public.document_extractions
     set status              = 'confirmed',
         vehicle_id          = p_vehicle,
         confirmed_category  = p_category,
         confirmed_data      = p_payload,
         confirmed_at        = now(),
         confirmed_by        = v_actor,
         created_record_type = p_category,
         created_record_id   = v_record
   where id = p_extraction and organization_id = v_org;

  return jsonb_build_object(
    'state', 'ok', 'record_type', p_category, 'record_id', v_record
  );
end;
$function$
;

comment on function public.confirm_fleet_intake(uuid, uuid, text, jsonb) is
  'The single write point of Fleet document intake. Locks the extraction, refuses a second confirmation (returning the first record instead), refuses a cancelled/superseded/failed review, re-resolves the vehicle inside the caller''s organization, creates exactly one operational record linked to the source document, and applies monotonic derived-field updates. Requires owner/admin/fleet_manager.';

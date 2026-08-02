-- =============================================================================
-- Vin.ID — Vehicle registration document AI intake: CREATE a vehicle
-- =============================================================================
-- Task E adds a third Add-Vehicle method: scan a vehicle registration document,
-- let the existing AI intake extract identity fields, compare with the official
-- government source, review, and confirm. Unlike fleet intake (which files a
-- document against an EXISTING vehicle), this flow CREATES the vehicle at
-- confirmation.
--
-- REUSE, NOT A SECOND PIPELINE. It reuses `document_extractions` as the pending
-- intake session (staged file columns already exist, added by
-- 20260726120000_fleet_document_intake.sql) and the private documents bucket.
-- This migration only:
--   1. widens three CHECK vocabularies so this flow is representable,
--   2. adds ONE atomic, idempotent confirmation RPC that creates the vehicle,
--      files the document, links the extraction, and (opt-in) a reminder.
--
-- THE SAFETY RULE, again enforced in the database:
--   upload → extract → review/edit → EXPLICIT confirm → creation.
-- `confirm_vehicle_registration_intake()` is the only new write point, and it
-- refuses to run twice.
--
-- Additive and idempotent. No column dropped/renamed/retyped; the widened checks
-- are supersets of the old ones, so every existing row stays valid.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Widen the vocabularies
-- -----------------------------------------------------------------------------
-- A new intake surface: the vehicle-registration → new-vehicle flow.
alter table public.document_extractions
  drop constraint if exists document_extractions_source_check;
alter table public.document_extractions
  add constraint document_extractions_source_check
  check (source in ('document_metadata', 'fleet_intake', 'scan', 'vehicle_registration'));

-- The confirmed record this intake produces can now be a VEHICLE (fleet intake
-- produces maintenance/insurance/registration/inspection).
alter table public.document_extractions
  drop constraint if exists document_extractions_record_type_check;
alter table public.document_extractions
  add constraint document_extractions_record_type_check
  check (created_record_type is null or created_record_type in (
    'maintenance', 'insurance', 'registration', 'inspection', 'vehicle'
  ));

-- Provenance of a vehicle's initial data gains two values:
--   vehicle_registration_ai — created from a scanned registration document
--   mixed_confirmed         — user confirmed values drawn from >1 source
-- (Task D added 'manual' and 'israel_government'.)
alter table public.vehicles
  drop constraint if exists vehicles_data_source_check;
alter table public.vehicles
  add constraint vehicles_data_source_check
  check (data_source is null or data_source in (
    'manual', 'israel_government', 'vehicle_registration_ai', 'mixed_confirmed'
  ));

-- -----------------------------------------------------------------------------
-- 2. The confirmation transaction — CREATE the vehicle
-- -----------------------------------------------------------------------------
/**
 * Turn a reviewed vehicle-registration intake into exactly one new vehicle.
 *
 * The ONLY new write point of this flow, and the enforcement point for every
 * rule:
 *   * caller must be authenticated, a live member, and a WRITER
 *     (owner/admin/fleet_manager — never viewer, never driver),
 *   * the extraction row is locked FOR UPDATE, so concurrent confirmations
 *     serialize instead of racing,
 *   * an already-confirmed intake returns its EXISTING vehicle/document ids
 *     rather than creating a second vehicle — double-click / retry are no-ops,
 *   * a workspace-scoped duplicate registration number blocks creation and
 *     returns the existing vehicle (never a global constraint, never cross-org),
 *   * the file staged at upload is filed as the vehicle's registration document
 *     inside the same transaction, so vehicle and document cannot exist apart,
 *   * source metadata is server-validated (data_source allowlist; the government
 *     resource id is whatever the caller passes from server config, never a
 *     forgeable client value here because the action supplies it),
 *   * the original extraction is preserved; confirmed values go to confirmed_data.
 *
 * p_vehicle keys (all optional except make/model/year): make, model, year, vin,
 * license_plate, color, fuel_type, test_expiry_date.
 * p_government: null, or {fetched_at, resource_id} when a lookup was used.
 *
 * Returns jsonb {state, vehicle_id?, document_id?, existing_vehicle_id?}.
 * States: ok, already_confirmed, duplicate, not_authenticated, not_authorized,
 * extraction_not_found, invalid_payload, invalid_source, stale.
 */
create or replace function public.confirm_vehicle_registration_intake(
  p_extraction       uuid,
  p_vehicle          jsonb,
  p_data_source      text,
  p_government       jsonb default null,
  p_create_reminder  boolean default false,
  p_reminder_lead_days integer default 30
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org     uuid := public.current_org_id();
  v_actor   uuid := auth.uid();
  v_ex      public.document_extractions%rowtype;
  v_owner   uuid;
  v_make    text;
  v_model   text;
  v_year    integer;
  v_plate   text;
  v_plate_key text;
  v_existing uuid;
  v_vehicle uuid;
  v_doc     uuid;
  v_expiry  date;
begin
  if v_actor is null then
    return jsonb_build_object('state', 'not_authenticated');
  end if;
  -- owner/admin/fleet_manager only (viewer + driver excluded).
  if not public.is_org_writer() then
    return jsonb_build_object('state', 'not_authorized');
  end if;

  -- Lock the intake. Serializes concurrent confirmations for this extraction.
  select * into v_ex
  from public.document_extractions
  where id = p_extraction
    and organization_id = v_org
    and source = 'vehicle_registration'
  for update;

  if not found then
    return jsonb_build_object('state', 'extraction_not_found');
  end if;

  -- IDEMPOTENCY: already confirmed → return what was created before.
  if v_ex.status = 'confirmed' then
    return jsonb_build_object(
      'state', 'already_confirmed',
      'vehicle_id', v_ex.created_record_id,
      'document_id', v_ex.document_id
    );
  end if;
  if v_ex.status in ('cancelled', 'superseded') then
    return jsonb_build_object('state', 'stale');
  end if;

  if p_data_source is null or p_data_source not in
     ('vehicle_registration_ai', 'mixed_confirmed') then
    return jsonb_build_object('state', 'invalid_source');
  end if;

  -- Required identity fields.
  v_make := nullif(btrim(coalesce(p_vehicle->>'make', '')), '');
  v_model := nullif(btrim(coalesce(p_vehicle->>'model', '')), '');
  v_year := nullif(p_vehicle->>'year', '')::int;
  if v_make is null or v_model is null or v_year is null
     or v_year < 1900 or v_year > extract(year from now())::int + 1 then
    return jsonb_build_object('state', 'invalid_payload');
  end if;

  v_plate := nullif(btrim(coalesce(p_vehicle->>'license_plate', '')), '');
  v_expiry := nullif(p_vehicle->>'test_expiry_date', '')::date;

  -- Workspace-scoped duplicate check (never global, never cross-org). A plate
  -- that already exists in THIS organization blocks creation.
  v_plate_key := public.normalize_plate(v_plate);
  if v_plate_key is not null then
    select v.id into v_existing
    from public.vehicles v
    where v.organization_id = v_org
      and v.deleted_at is null
      and public.normalize_plate(v.license_plate) = v_plate_key
    limit 1;
    if v_existing is not null then
      return jsonb_build_object('state', 'duplicate', 'existing_vehicle_id', v_existing);
    end if;
  end if;

  v_owner := coalesce(v_ex.owner_user_id, v_actor);

  -- Create the vehicle. organization_id is supplied explicitly (the BEFORE INSERT
  -- trigger would otherwise derive it from the owner's profile cache).
  insert into public.vehicles (
    owner_user_id, organization_id,
    make, model, year, vin, license_plate, color, fuel_type,
    mileage_unit, operational_status, status,
    test_expiry_date, data_source, government_fetched_at, government_resource_id
  ) values (
    v_owner, v_org,
    v_make, v_model, v_year,
    nullif(btrim(coalesce(p_vehicle->>'vin', '')), ''),
    v_plate,
    nullif(btrim(coalesce(p_vehicle->>'color', '')), ''),
    nullif(btrim(coalesce(p_vehicle->>'fuel_type', '')), ''),
    'km', 'active', 'active',
    v_expiry, p_data_source,
    nullif(p_government->>'fetched_at', '')::timestamptz,
    nullif(p_government->>'resource_id', '')
  ) returning id into v_vehicle;

  -- File the staged upload as the vehicle's registration document, in the same
  -- transaction — vehicle and its document never exist without each other.
  -- contains_personal_info defaults true, share_allowed false (documents module).
  insert into public.vehicle_documents (
    owner_user_id, organization_id, vehicle_id, doc_type,
    storage_path, file_name, mime_type, file_size, content_hash,
    document_date, trust_label, contains_personal_info, share_allowed
  ) values (
    v_owner, v_org, v_vehicle, 'registration',
    v_ex.pending_storage_path, v_ex.pending_file_name,
    v_ex.pending_mime_type, v_ex.pending_file_size, v_ex.content_hash,
    v_expiry, 'ai_extracted', true, false
  ) returning id into v_doc;

  -- Opt-in reminder only. Never created silently. reminder_type 'inspection'
  -- (the test/registration check), due a lead time before expiry.
  if p_create_reminder and v_expiry is not null then
    insert into public.reminders (
      owner_user_id, organization_id, vehicle_id, title,
      reminder_type, due_date
    ) values (
      v_owner, v_org, v_vehicle, 'Vehicle test expiry',
      'inspection', v_expiry - make_interval(days => greatest(coalesce(p_reminder_lead_days, 30), 0))
    );
  end if;

  -- Finalize the intake: preserve extracted_data, record the confirmed values,
  -- link the created vehicle and its document.
  update public.document_extractions
     set status              = 'confirmed',
         vehicle_id          = v_vehicle,
         document_id         = v_doc,
         confirmed_data      = p_vehicle,
         confirmed_at        = now(),
         confirmed_by        = v_actor,
         created_record_type = 'vehicle',
         created_record_id   = v_vehicle
   where id = p_extraction and organization_id = v_org;

  return jsonb_build_object(
    'state', 'ok', 'vehicle_id', v_vehicle, 'document_id', v_doc
  );
end;
$$;

comment on function public.confirm_vehicle_registration_intake(uuid, jsonb, text, jsonb, boolean, integer) is
  'The single write point of vehicle-registration AI intake. Locks the extraction, refuses a second confirmation (returning the first vehicle), enforces a workspace-scoped duplicate registration check, creates exactly one vehicle plus its registration document atomically, records provenance, and optionally an opt-in test reminder. Requires owner/admin/fleet_manager.';

revoke all on function public.confirm_vehicle_registration_intake(uuid, jsonb, text, jsonb, boolean, integer) from public, anon;
grant execute on function public.confirm_vehicle_registration_intake(uuid, jsonb, text, jsonb, boolean, integer) to authenticated;

-- =============================================================================
-- End of migration
-- =============================================================================

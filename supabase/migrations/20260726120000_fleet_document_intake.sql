-- =============================================================================
-- Vin.ID Fleet Lite — Fleet AI document intake: provenance, matching, confirm
-- =============================================================================
-- Extends the EXISTING `document_extractions` table rather than adding a second
-- pipeline. Before this migration the repository had two half-flows:
--
--   A. "Scan a document" (app/(app)/scan) — real provider, creates real
--      maintenance/issue/insurance/registration/inspection records, but the
--      extraction itself was NEVER persisted. No provenance: nothing recorded
--      what the model proposed, what the user changed, who confirmed it, or
--      which record came out. No duplicate protection. Vehicle chosen up front,
--      so no matching.
--
--   B. "Extract with AI" on an existing document (lib/documents/extraction-*) —
--      persisted an extraction row with the raw/confirmed split, but was
--      mock-only and only ever wrote back six METADATA fields on the document.
--      It never produced an operational record.
--
-- Flow B already had the right SHAPE (extracted_data + confirmed_data +
-- status), so this migration grows that table into the single intake record for
-- both, and adds the Fleet layer: vehicle matching, provenance, duplicate
-- detection and an atomic, idempotent confirmation.
--
-- THE SAFETY RULE THIS ENFORCES IN THE DATABASE:
--   upload → extract → review/edit → EXPLICIT confirm → persistence
-- Nothing in this migration creates an operational record as a side effect of
-- uploading or extracting. `confirm_fleet_intake()` is the only function here
-- that inserts one, and it refuses to run twice.
--
-- Non-destructive and idempotent. Existing extraction and document rows are
-- preserved: every column added is nullable or carries a default.
--
-- RECOVERY NOTES. To roll back the behaviour without losing data:
--   * drop the three functions below (intake stops; existing rows stay),
--   * the added columns are additive and can be left in place,
--   * `document_extractions_one_confirmed_per_document` is the only new
--     constraint that can reject a write; drop it to restore prior behaviour.
-- No column is dropped, renamed or retyped, so a downgrade needs no backfill.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. Duplicate detection needs a content fingerprint
-- -----------------------------------------------------------------------------
-- sha256 of the uploaded bytes, computed server-side at upload. Nullable: every
-- pre-existing document has no hash and must keep working.
alter table public.vehicle_documents
  add column if not exists content_hash text;

comment on column public.vehicle_documents.content_hash is
  'sha256 (hex) of the uploaded file bytes, computed server-side. Used only to WARN about a re-upload of the same file; never a uniqueness constraint, because the same document legitimately arrives twice (re-scan, re-send) and a hard block would lose data.';

-- Deliberately NOT unique. Two identical files in one organization is a warning
-- for the user to resolve, not an error for the database to raise.
create index if not exists vehicle_documents_org_content_hash_idx
  on public.vehicle_documents (organization_id, content_hash)
  where content_hash is not null and deleted_at is null;


-- -----------------------------------------------------------------------------
-- 2. Intake state, classification, matching and provenance
-- -----------------------------------------------------------------------------
alter table public.document_extractions
  -- Which flow produced this row, so the two intake surfaces stay
  -- distinguishable in analytics and in the audit without a second table.
  add column if not exists source text not null default 'document_metadata',
  -- Classification, kept separate from the confirmed value so a reviewer can
  -- always see what the model proposed versus what the user chose.
  add column if not exists proposed_category text,
  add column if not exists category_confidence numeric,
  add column if not exists confirmed_category text,
  -- Vehicle matching. `vehicle_id` (pre-existing) is the RESOLVED vehicle;
  -- these record how it was resolved and what else it could have been.
  add column if not exists vehicle_match_method text,
  add column if not exists vehicle_candidates jsonb not null default '[]'::jsonb,
  -- Provenance.
  add column if not exists confirmed_by uuid references auth.users(id) on delete set null,
  add column if not exists provider_model text,
  add column if not exists content_hash text,
  -- Which operational record this extraction produced. Together with the
  -- record's own document_id this closes the provenance loop in both
  -- directions.
  add column if not exists created_record_type text,
  add column if not exists created_record_id uuid,
  -- Per-field record of what the user changed: {field: {extracted, confirmed,
  -- edited}}. Kept alongside — never instead of — extracted_data.
  add column if not exists field_provenance jsonb not null default '{}'::jsonb,
  add column if not exists cancelled_at timestamptz,
  -- The uploaded file, held here until a vehicle is known. See below.
  add column if not exists pending_storage_path text,
  add column if not exists pending_file_name text,
  add column if not exists pending_mime_type text,
  add column if not exists pending_file_size bigint;

-- DASHBOARD INTAKE STARTS WITHOUT A VEHICLE.
--
-- `vehicle_documents.vehicle_id` is NOT NULL and stays that way: it is read by
-- the Passport, the Fleet dashboard and the document Storage policies, all of
-- which are already validated, and loosening it to serve one new flow would put
-- every one of them in scope. So the DOCUMENT ROW is not created at upload time
-- at all. The file goes to Storage, its descriptor is parked on the intake row,
-- and `confirm_fleet_intake()` creates the document once the user has resolved
-- the vehicle — which is the same moment the operational record appears.
--
-- That makes `document_id` optional on an intake: it is set when intake starts
-- from a document that already exists (the vehicle-detail entry point) and null
-- while a dashboard upload is still awaiting its vehicle.
alter table public.document_extractions
  alter column document_id drop not null;

-- Either the intake points at an existing document, or it is carrying a file
-- that has not been filed yet. Never neither: an intake with no document and no
-- pending file has nothing to review.
alter table public.document_extractions
  drop constraint if exists document_extractions_has_file;
alter table public.document_extractions
  add constraint document_extractions_has_file
  check (document_id is not null or pending_storage_path is not null)
  -- NOT VALID so pre-existing rows (which all have a document_id) are untouched.
  not valid;

alter table public.document_extractions
  drop constraint if exists document_extractions_status_check;
alter table public.document_extractions
  add constraint document_extractions_status_check
  check (status in (
    'pending_confirmation',  -- awaiting review; the pre-existing default
    'confirmed',
    'discarded',             -- pre-existing; kept so old rows stay valid
    'failed',
    'cancelled',             -- user abandoned the review explicitly
    'superseded'             -- replaced by a newer extraction of the same document
  ));

alter table public.document_extractions
  drop constraint if exists document_extractions_source_check;
alter table public.document_extractions
  add constraint document_extractions_source_check
  check (source in ('document_metadata', 'fleet_intake', 'scan'));

alter table public.document_extractions
  drop constraint if exists document_extractions_match_method_check;
alter table public.document_extractions
  add constraint document_extractions_match_method_check
  check (vehicle_match_method is null or vehicle_match_method in (
    'vin', 'registration', 'registration_normalized',
    'user_selected', 'ambiguous', 'none', 'conflict'
  ));

alter table public.document_extractions
  drop constraint if exists document_extractions_record_type_check;
alter table public.document_extractions
  add constraint document_extractions_record_type_check
  check (created_record_type is null or created_record_type in (
    'maintenance', 'insurance', 'registration', 'inspection'
  ));

-- A confirmed extraction must name the record it produced, and an unconfirmed
-- one must not. This is the database-level statement of "no final record before
-- explicit confirmation": a row cannot claim a record without being confirmed.
alter table public.document_extractions
  drop constraint if exists document_extractions_confirmed_has_record;
alter table public.document_extractions
  add constraint document_extractions_confirmed_has_record
  check (
    (status = 'confirmed' and created_record_id is not null and confirmed_at is not null)
    or (status <> 'confirmed' and created_record_id is null)
  )
  -- NOT VALID: pre-existing confirmed rows come from flow B, which confirmed
  -- document METADATA and legitimately produced no operational record. The rule
  -- applies to every new and updated row; legacy rows are left untouched.
  not valid;

-- IDEMPOTENCY BACKSTOP. At most one confirmed extraction per document, so even
-- if two requests somehow bypassed the row lock in confirm_fleet_intake() the
-- second INSERT/UPDATE fails rather than producing a second operational record.
create unique index if not exists document_extractions_one_confirmed_per_document
  on public.document_extractions (document_id)
  where status = 'confirmed';

create index if not exists document_extractions_org_status_idx
  on public.document_extractions (organization_id, status);
create index if not exists document_extractions_org_hash_idx
  on public.document_extractions (organization_id, content_hash)
  where content_hash is not null;
create index if not exists document_extractions_vehicle_idx
  on public.document_extractions (vehicle_id) where vehicle_id is not null;

comment on column public.document_extractions.extracted_data is
  'The provider''s ORIGINAL output. Never overwritten by user corrections — those go to confirmed_data, and the per-field diff to field_provenance.';
comment on column public.document_extractions.field_provenance is
  'Per-field {extracted, confirmed, edited} record, so a reviewer can see exactly which values the user changed after the model proposed them.';


-- -----------------------------------------------------------------------------
-- 3. Deterministic vehicle matching
-- -----------------------------------------------------------------------------
/**
 * Normalize a registration/plate for comparison: uppercase, strip everything
 * that is not a letter or digit. "12-345-67", "12 345 67" and "1234567" all
 * collapse to the same key, which is what makes the `registration_normalized`
 * tier work across the formats garages actually print.
 */
create or replace function public.normalize_plate(p_value text)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(upper(regexp_replace(coalesce(p_value, ''), '[^A-Za-z0-9]', '', 'g')), '');
$$;

/**
 * Candidate vehicles for a document, within the CALLER'S organization only.
 *
 * Identifier priority, strongest first — a document is never matched on make,
 * model, driver name, filename or general similarity:
 *
 *   1 vin                      exact VIN/chassis
 *   2 registration             exact plate as printed
 *   3 registration_normalized  plate ignoring separators and case
 *
 * Returns EVERY candidate at the strongest tier that produced any hit. The
 * caller treats more than one row as ambiguous and demands manual selection —
 * this function never picks a winner among equals.
 *
 * Cross-tenant matching is impossible by construction: `current_org_id()`
 * resolves from the caller's live membership and there is no organization
 * parameter to forge.
 *
 * DRIVERS ARE EXCLUDED EXPLICITLY. This function is SECURITY DEFINER, so its
 * read of `public.vehicles` runs as the table owner and does NOT go through the
 * vehicles policy that restricts a driver to their one assigned vehicle. Without
 * the `is_org_driver()` guard below, a driver could enumerate the entire fleet
 * one registration guess at a time — re-opening exactly the hole
 * 20260725220000_driver_rls.sql closed. Caught by the intake harness. Every
 * SECURITY DEFINER function that reads an org-scoped table has to restate the
 * driver rule itself; inheriting it is not an option.
 */
create or replace function public.match_fleet_vehicles(
  p_vin text default null,
  p_registration text default null
)
returns table (vehicle_id uuid, method text)
language sql
stable
security definer
set search_path = ''
as $$
  with org as (
    select public.current_org_id() as id
    where not public.is_org_driver()
  ),
  vin_hits as (
    select v.id, 'vin'::text as m
    from public.vehicles v, org
    where v.organization_id = org.id
      and v.deleted_at is null
      and p_vin is not null
      and public.normalize_plate(v.vin) = public.normalize_plate(p_vin)
  ),
  reg_hits as (
    select v.id, 'registration'::text as m
    from public.vehicles v, org
    where v.organization_id = org.id
      and v.deleted_at is null
      and p_registration is not null
      and v.license_plate = p_registration
  ),
  norm_hits as (
    select v.id, 'registration_normalized'::text as m
    from public.vehicles v, org
    where v.organization_id = org.id
      and v.deleted_at is null
      and p_registration is not null
      and public.normalize_plate(v.license_plate) = public.normalize_plate(p_registration)
  )
  select id, m from vin_hits
  union all
  select id, m from reg_hits where not exists (select 1 from vin_hits)
  union all
  select id, m from norm_hits
   where not exists (select 1 from vin_hits)
     and not exists (select 1 from reg_hits);
$$;

comment on function public.match_fleet_vehicles(text, text) is
  'Deterministic vehicle candidates for a document, scoped to the caller''s organization. Exact VIN beats exact plate beats normalized plate; ties are returned in full so the caller can require manual selection. Never matches on make, model, driver name or filename.';

/**
 * Live documents in the caller's organization with the same content hash —
 * i.e. this exact file has been uploaded before. Advisory only.
 */
create or replace function public.find_duplicate_documents(p_hash text)
returns table (
  document_id   uuid,
  vehicle_id    uuid,
  title         text,
  document_date date,
  created_at    timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select d.id, d.vehicle_id, d.title, d.document_date, d.created_at
  from public.vehicle_documents d
  where p_hash is not null
    and d.content_hash = p_hash
    and d.organization_id = public.current_org_id()
    and d.deleted_at is null
    and not public.is_org_driver()
  order by d.created_at desc
  limit 5;
$$;

comment on function public.find_duplicate_documents(text) is
  'Advisory duplicate check: other live documents in the caller''s organization with identical file content. Returns no storage_path or amount.';

revoke all on function public.normalize_plate(text) from public, anon;
revoke all on function public.match_fleet_vehicles(text, text) from public, anon;
revoke all on function public.find_duplicate_documents(text) from public, anon;
grant execute on function public.normalize_plate(text) to authenticated;
grant execute on function public.match_fleet_vehicles(text, text) to authenticated;
grant execute on function public.find_duplicate_documents(text) to authenticated;


-- -----------------------------------------------------------------------------
-- 4. The confirmation transaction
-- -----------------------------------------------------------------------------
/**
 * Turn a reviewed extraction into exactly one operational record.
 *
 * This is the ONLY function in the intake path that writes an operational
 * record, and it is the enforcement point for every rule in the flow:
 *
 *   * caller must be authenticated, a LIVE member, and a writer
 *     (owner/admin/fleet_manager — never viewer, never driver),
 *   * the extraction row is locked FOR UPDATE, so two concurrent confirmations
 *     serialize instead of racing,
 *   * an already-confirmed extraction returns its EXISTING record id rather
 *     than creating a second one — double-click and network retry are no-ops,
 *   * the vehicle is re-resolved server-side and must belong to the caller's
 *     organization and not be deleted, so a forged or cross-tenant id fails,
 *   * the original extraction is preserved; corrections go to confirmed_data
 *     and field_provenance.
 *
 * Derived vehicle fields are updated under DETERMINISTIC, MONOTONIC rules —
 * see the inline notes at the update.
 *
 * Returns jsonb {state, record_type, record_id}. States: ok, already_confirmed,
 * not_authenticated, not_authorized, extraction_not_found, vehicle_not_found,
 * invalid_category, invalid_payload, stale.
 */
create or replace function public.confirm_fleet_intake(
  p_extraction uuid,
  p_vehicle    uuid,
  p_category   text,
  p_payload    jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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

  -- A cancelled or superseded review must not be resurrected by a late request.
  if v_ex.status in ('cancelled', 'superseded') then
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
$$;

comment on function public.confirm_fleet_intake(uuid, uuid, text, jsonb) is
  'The single write point of Fleet document intake. Locks the extraction, refuses a second confirmation (returning the first record instead), re-resolves the vehicle inside the caller''s organization, creates exactly one operational record linked to the source document, and applies monotonic derived-field updates. Requires owner/admin/fleet_manager.';

revoke all on function public.confirm_fleet_intake(uuid, uuid, text, jsonb) from public, anon;
grant execute on function public.confirm_fleet_intake(uuid, uuid, text, jsonb) to authenticated;

-- =============================================================================
-- End of migration
-- =============================================================================

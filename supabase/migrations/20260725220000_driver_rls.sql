-- =============================================================================
-- Vin.ID Fleet Lite — driver-aware RLS, Storage and safe read paths
-- =============================================================================
-- The companion to 20260725210000. That migration defined the `driver` role;
-- this one makes it safe to hold. The two must ship together as one security
-- unit: applying 210000 alone hands out a role that the policies below have not
-- yet constrained.
--
-- THE LEAK THIS CLOSES. The Fleet conversion (20260722120000) generated the SAME
-- policy for ELEVEN org-scoped tables:
--
--     using (organization_id = public.current_org_id())
--
-- with no role condition at all. That is correct for owner/admin/fleet_manager/
-- viewer, who are all organization-wide by design. It is catastrophic the moment
-- a `driver` holds a membership row, because organization membership alone then
-- returns the entire fleet.
--
-- An earlier draft of this migration made only FIVE tables driver-aware
-- (vehicles, maintenance_logs, issue_logs, reminders, vehicle_documents) and
-- silently left the other SIX on the bare organization-wide rule:
--
--   1. vehicle_insurance     insurer_name + cost for every vehicle in the fleet
--   2. vehicle_inspection    cost + free-text notes for every vehicle
--   3. vehicle_registration  free-text notes for every vehicle
--   4. document_extractions  raw_text / extracted_data — the OCR body of every
--                            scanned invoice in the organization
--   5. vehicle_passports     snapshot — the FULL frozen history of every vehicle,
--                            which re-exposes exactly the maintenance costs that
--                            the maintenance_logs rule below denies, plus
--                            snapshot_hash and server_signature
--   6. transfer_tokens       token_hash and passport transfer state
--
-- Table 5 is worth stating plainly: denying maintenance_logs while leaving
-- vehicle_passports organization-wide would have been security theatre. The
-- passport snapshot is a superset of the data the maintenance rule protects.
--
-- Two further defects, in the draft's own additions rather than in what it
-- missed, are also corrected here:
--
--   7. vehicle_documents  the draft granted drivers the whole ROW for a
--                         driver-visible document. RLS is row-level, not
--                         column-level, so that row carried `storage_path`,
--                         `amount`, `currency`, `vendor` and `owner_user_id` —
--                         the raw Storage path and the document's financial
--                         values, which the draft's own header promised drivers
--                         would never see. A UI that omits those columns does
--                         not protect them: `select *` through PostgREST returns
--                         them regardless. Documents are now RPC-only.
--   8. driver_assignments the draft let a driver read their own assignment row,
--                         which carries `note` — a manager's free-text remark
--                         ABOUT that driver. Assignments are now manager-only;
--                         the driver learns their vehicle from an RPC.
--
-- DEFAULT DENY for drivers. A driver is not granted a related record merely
-- because it shares a vehicle_id with their vehicle. Each category is decided
-- explicitly, and anything not named here is denied:
--
--   vehicles              the assigned vehicle only (row-level)
--   reminders             assigned vehicle AND driver_visible (row-level)
--   organization_members  their own membership row only
--   vehicle_documents     NO direct access — safe fields via RPC only
--   maintenance_logs      NO direct access — safe fields via RPC only
--   issue_logs            NO access at all
--   organizations         NO direct access — name only, via RPC
--   driver_assignments    NO direct access — vehicle only, via RPC
--   the six tables above  NO access at all
--
-- WHY MAINTENANCE AND DOCUMENTS ARE RPCs. RLS is row-level, not column-level.
-- Any policy that lets a driver read a maintenance row also lets them read
-- `cost` straight from PostgREST, whatever the application UI renders. The only
-- way to expose service history without exposing money is to not grant the row
-- at all and return an explicit column list from a SECURITY DEFINER function.
-- The same reasoning applies to documents and their Storage paths.
--
-- DOCUMENT VISIBILITY — Option A (explicit `driver_visible` flag), default false.
--   Rejected Option B (a confirmed-type allowlist such as registration / test /
--   insurance): `doc_type` is free-ish text set at upload, an unreviewed or
--   mis-typed invoice would be auto-shared, and it offers a manager no way to
--   withhold a specific file. Rejected Option C (allowlist + override) as strictly
--   more machinery for the same result, with the allowlist's failure mode intact.
--   An explicit flag is the smallest model that is default-deny and auditable:
--   nothing reaches a driver unless a manager deliberately marked that file.
--
-- WHY THIS FILE WAS CORRECTED IN PLACE rather than patched by a later migration:
-- both driver migrations are still uncommitted and have never been applied to
-- any database other than a local reset. Shipping a knowingly-leaky migration
-- plus a follow-up fix would put a window of organization-wide driver access
-- into the permanent history for no benefit. Git history confirms neither file
-- has been committed.
--
-- Non-destructive and idempotent.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Explicit driver visibility, default deny
-- -----------------------------------------------------------------------------
alter table public.vehicle_documents
  add column if not exists driver_visible boolean not null default false;
alter table public.reminders
  add column if not exists driver_visible boolean not null default false;

comment on column public.vehicle_documents.driver_visible is
  'Opt-in: false by default, so invoices, quotes and internal paperwork are never exposed to a driver. Only a manager marking a file shares it, and only with the vehicle''s currently assigned driver — and even then only the safe columns returned by get_driver_documents(), never storage_path or amount.';
comment on column public.reminders.driver_visible is
  'Opt-in: false by default. Reminders may carry internal administrative notes, so a driver sees only reminders a manager deliberately shared.';

create index if not exists vehicle_documents_driver_visible_idx
  on public.vehicle_documents (vehicle_id) where driver_visible;
create index if not exists reminders_driver_visible_idx
  on public.reminders (vehicle_id) where driver_visible;

-- -----------------------------------------------------------------------------
-- 2. vehicles — a driver sees one vehicle
-- -----------------------------------------------------------------------------
-- Writes are unchanged: they already require is_org_writer(), which is
-- owner/admin/fleet_manager, so `driver` (like `viewer`) cannot write.
--
-- THE PREDICATE MUST READ THE ROW, NOT RE-QUERY THE TABLE.
--
-- An earlier draft wrote this policy as `using (public.can_access_vehicle(id))`.
-- That is subtly broken: `can_access_vehicle()` is STABLE and, for a non-driver,
-- answers by running `select 1 from public.vehicles where id = ...`. A STABLE
-- function sees the snapshot from the START of the statement, so during
-- `INSERT ... RETURNING` the row being inserted is not visible to it. Postgres
-- applies the SELECT policy to the RETURNING clause, the predicate returned
-- false, and the whole statement failed with:
--
--     new row violates row-level security policy for table "vehicles"
--
-- The INSERT itself was fine — an insert with no RETURNING succeeded and the row
-- was created. Only the read-back failed, which is exactly what every
-- `.insert(...).select().single()` in the app does. Caught by the Fleet tenancy,
-- document Storage and organization-members harnesses, all of which create a
-- vehicle that way.
--
-- Comparing `organization_id` on the row under evaluation has no such problem,
-- restores the pre-driver behaviour for every other role verbatim, and keeps the
-- driver restricted to their assignment. `current_driver_vehicle_id()` reads a
-- DIFFERENT table (driver_assignments), so the snapshot issue cannot recur — and
-- drivers cannot insert vehicles at all.
drop policy if exists "vehicles_select_org" on public.vehicles;
create policy "vehicles_select_org" on public.vehicles
  for select using (
    case
      when public.is_org_driver()
        then id = public.current_driver_vehicle_id()
      else organization_id = public.current_org_id()
    end
  );

-- -----------------------------------------------------------------------------
-- 3. Tables a driver may not read at all
-- -----------------------------------------------------------------------------
-- One uniform correction applied to every remaining org-scoped table. The
-- organization-wide rule is preserved verbatim for owner/admin/fleet_manager/
-- viewer; only `driver` is subtracted. Writes are untouched throughout: they
-- already require is_org_writer(), which never includes `driver`.
--
-- issue_logs is here deliberately. Driver issue reporting is out of scope for
-- this phase, so a driver gets no read and no write on the issue table; a safe
-- operational warning, if one is ever needed, comes from a vehicle-level field.
do $$
declare
  t text;
  driver_denied_tables text[] := array[
    'maintenance_logs',      -- cost, currency, vendor_name, free-text description
    'issue_logs',            -- internal diagnosis notes; reporting is out of scope
    'vehicle_insurance',     -- LEAK 1: insurer_name, cost
    'vehicle_inspection',    -- LEAK 2: cost, notes
    'vehicle_registration',  -- LEAK 3: notes
    'document_extractions',  -- LEAK 4: raw_text, extracted_data, confirmed_data
    'vehicle_passports',     -- LEAK 5: snapshot, snapshot_hash, server_signature
    'transfer_tokens',       -- LEAK 6: token_hash, transfer state
    'vehicle_documents'      -- LEAK 7: storage_path, amount, currency, vendor
  ];
begin
  foreach t in array driver_denied_tables loop
    execute format('drop policy if exists %I on public.%I', t || '_select_org', t);
    execute format(
      'create policy %I on public.%I for select using (organization_id = public.current_org_id() and not public.is_org_driver())',
      t || '_select_org', t
    );
  end loop;
end;
$$;

-- -----------------------------------------------------------------------------
-- 4. reminders — assigned vehicle AND explicitly shared
-- -----------------------------------------------------------------------------
-- The one related table a driver reads directly. Every column on `reminders`
-- (title, description, due_date, due_mileage, urgency, status) is operational
-- and is the substance of what a manager chose to share; `driver_visible` is
-- explicit per-row consent covering the whole row.
drop policy if exists "reminders_select_org" on public.reminders;
create policy "reminders_select_org" on public.reminders
  for select using (
    organization_id = public.current_org_id()
    and (
      not public.is_org_driver()
      or (driver_visible and vehicle_id = public.current_driver_vehicle_id())
    )
  );

-- -----------------------------------------------------------------------------
-- 5. organization_members — a driver sees only themselves
-- -----------------------------------------------------------------------------
-- The roster policy was org-wide for every member, so a driver could enumerate
-- their colleagues, their user ids and their roles. Managers keep the full
-- roster; a driver sees exactly their own row, which is what the app needs to
-- resolve their own role.
--
-- No recursion: is_org_driver() and current_org_id() are SECURITY DEFINER and
-- therefore evaluate without re-entering this policy.
drop policy if exists "org_members_select_same_org" on public.organization_members;
create policy "org_members_select_same_org" on public.organization_members
  for select using (
    organization_id = public.current_org_id()
    and (not public.is_org_driver() or user_id = auth.uid())
  );

-- -----------------------------------------------------------------------------
-- 6. organizations — a driver reads the name through an RPC, not the row
-- -----------------------------------------------------------------------------
-- The organizations row carries subscription_status, plan, contact_name, phone
-- and email — the employer's commercial and contact details, none of which a
-- driver needs. Driver View shows the organization NAME, which comes from
-- get_my_driver_vehicle() below.
drop policy if exists "organizations_select_own" on public.organizations;
create policy "organizations_select_own" on public.organizations
  for select using (
    id = public.current_org_id()
    and not public.is_org_driver()
  );

-- -----------------------------------------------------------------------------
-- 7. driver_assignments — manager-only; `note` is about the driver, not for them
-- -----------------------------------------------------------------------------
drop policy if exists "driver_assignments_select" on public.driver_assignments;
create policy "driver_assignments_select" on public.driver_assignments
  for select using (
    organization_id = public.current_org_id()
    and public.can_manage_driver_assignments()
  );

-- -----------------------------------------------------------------------------
-- 8. Storage — the same rule, applied to the object
-- -----------------------------------------------------------------------------
-- Authorization still keys off the DOCUMENT ROW's organization (never the path
-- prefix), and now additionally off driver visibility and the active assignment.
-- The bucket remains private; no policy here makes anything public.
--
-- This function is intentionally NOT gated on the driver's table SELECT (which
-- section 3 removed). Storage authorization is decided here, on the object, so a
-- driver can still open a file a manager shared with them even though they can
-- never enumerate the document table.
create or replace function public.can_read_document_object(p_object_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.vehicle_documents d
    where d.storage_path = p_object_name
      and d.organization_id = public.current_org_id()
      and d.deleted_at is null
      and (
        not public.is_org_driver()
        or (d.driver_visible and d.vehicle_id = public.current_driver_vehicle_id())
      )
  );
$$;

comment on function public.can_read_document_object(text) is
  'Storage read authorization by the DOCUMENT ROW''s organization. Drivers additionally require the file to be driver_visible AND attached to their actively assigned vehicle, so unassignment or membership removal stops new signed URLs immediately.';

-- -----------------------------------------------------------------------------
-- 9. Driver-safe read paths (explicit columns, no money, no Storage paths)
-- -----------------------------------------------------------------------------
-- Every function below takes NO vehicle argument. The vehicle is always resolved
-- server-side from the caller's own active assignment, so there is no id for a
-- client to guess, forge or substitute. Each re-checks is_org_driver() so a
-- non-driver calling them gets nothing, and each returns an explicit column list.

/**
 * The driver's own vehicle and assignment, plus the organization name.
 * Replaces direct SELECT on vehicles + driver_assignments + organizations.
 */
create or replace function public.get_my_driver_vehicle()
returns table (
  vehicle_id            uuid,
  nickname              text,
  make                  text,
  model                 text,
  year                  integer,
  license_plate         text,
  vin                   text,
  color                 text,
  vehicle_type          text,
  current_mileage       integer,
  mileage_unit          text,
  photo_url             text,
  operational_status    text,
  next_service_date     date,
  next_service_km       integer,
  test_expiry_date      date,
  insurance_expiry_date date,
  assigned_at           timestamptz,
  organization_name     text
)
language sql
stable
security definer
set search_path = ''
as $$
  select v.id, v.nickname, v.make, v.model, v.year, v.license_plate, v.vin,
         v.color, v.vehicle_type, v.current_mileage, v.mileage_unit, v.photo_url,
         v.operational_status, v.next_service_date, v.next_service_km,
         v.test_expiry_date, v.insurance_expiry_date,
         a.assigned_at, o.name
  from public.driver_assignments a
  join public.organization_members m
    on m.id = a.member_id
   and m.user_id = a.driver_user_id
   and m.organization_id = a.organization_id
  join public.vehicles v
    on v.id = a.vehicle_id
   and v.organization_id = a.organization_id
  join public.organizations o on o.id = a.organization_id
  where a.driver_user_id = auth.uid()
    and a.unassigned_at is null
    and m.role = 'driver'
    and v.deleted_at is null
  limit 1;
$$;

comment on function public.get_my_driver_vehicle() is
  'The caller''s actively assigned vehicle. Re-joins organization_members and re-checks the driver role, so a stale assignment belonging to a removed member returns nothing. Excludes owner_user_id, organization_id and the assignment note.';

/**
 * Service history for the assigned vehicle, restricted to non-commercial
 * columns. `cost`, `currency`, `vendor_name` and `description` are deliberately
 * absent: the first three are commercial, and free-text descriptions routinely
 * carry internal notes.
 */
create or replace function public.get_driver_maintenance_history(p_limit integer default 10)
returns table (
  id           uuid,
  service_type text,
  performed_at date,
  mileage      integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select l.id, l.service_type, l.performed_at, l.mileage
  from public.maintenance_logs l
  where l.vehicle_id = public.current_driver_vehicle_id()
    and public.is_org_driver()
    and l.deleted_at is null
  order by l.performed_at desc nulls last, l.created_at desc
  limit greatest(1, least(coalesce(p_limit, 10), 50));
$$;

comment on function public.get_driver_maintenance_history(integer) is
  'Service history for the caller''s actively assigned vehicle, restricted to non-commercial columns. Takes no vehicle argument: the vehicle comes from the caller''s own assignment.';

/**
 * Documents a manager explicitly shared for the assigned vehicle.
 *
 * Returns NO storage_path, NO amount, NO currency, NO vendor and NO
 * owner_user_id. The id returned here is the only handle a driver ever holds,
 * and it is the input to get_driver_document_path() below.
 */
create or replace function public.get_driver_documents()
returns table (
  id            uuid,
  doc_type      text,
  title         text,
  file_name     text,
  mime_type     text,
  document_date date,
  expiry_date   date,
  created_at    timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select d.id, d.doc_type, d.title, d.file_name, d.mime_type,
         d.document_date, d.expiry_date, d.created_at
  from public.vehicle_documents d
  where d.vehicle_id = public.current_driver_vehicle_id()
    and public.is_org_driver()
    and d.driver_visible
    and d.deleted_at is null
  order by d.document_date desc nulls last, d.created_at desc;
$$;

comment on function public.get_driver_documents() is
  'Driver-visible documents for the caller''s assigned vehicle. Deliberately omits storage_path, amount, currency, vendor and owner_user_id.';

/**
 * Resolve a document id to its Storage path, for the server-side signed-URL
 * flow only. Re-applies the full driver rule, so a guessed or stale document id
 * from another vehicle resolves to NULL rather than to a path.
 *
 * The path is returned to the SERVER, which mints a short-lived signed URL. It
 * is never sent to the browser.
 */
create or replace function public.get_driver_document_path(p_document uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select d.storage_path
  from public.vehicle_documents d
  where d.id = p_document
    and d.vehicle_id = public.current_driver_vehicle_id()
    and public.is_org_driver()
    and d.driver_visible
    and d.deleted_at is null;
$$;

comment on function public.get_driver_document_path(uuid) is
  'Server-side only: resolves a driver-visible document id to its Storage path for signed-URL minting. Returns NULL for any document outside the caller''s active assignment.';

/**
 * Reminders a manager shared for the assigned vehicle. The `reminders` policy
 * already permits these rows directly; this projection exists so the Driver View
 * reads the same explicit column list as every other driver surface.
 */
create or replace function public.get_driver_reminders()
returns table (
  id            uuid,
  title         text,
  description   text,
  reminder_type text,
  due_date      date,
  due_mileage   integer,
  urgency       text,
  status        text
)
language sql
stable
security definer
set search_path = ''
as $$
  select r.id, r.title, r.description, r.reminder_type, r.due_date,
         r.due_mileage, r.urgency, r.status
  from public.reminders r
  where r.vehicle_id = public.current_driver_vehicle_id()
    and public.is_org_driver()
    and r.driver_visible
    and r.deleted_at is null
  order by r.due_date asc nulls last;
$$;

comment on function public.get_driver_reminders() is
  'Driver-visible reminders for the caller''s assigned vehicle.';

revoke all on function public.get_my_driver_vehicle() from public, anon;
revoke all on function public.get_driver_maintenance_history(integer) from public, anon;
revoke all on function public.get_driver_documents() from public, anon;
revoke all on function public.get_driver_document_path(uuid) from public, anon;
revoke all on function public.get_driver_reminders() from public, anon;
grant execute on function public.get_my_driver_vehicle() to authenticated;
grant execute on function public.get_driver_maintenance_history(integer) to authenticated;
grant execute on function public.get_driver_documents() to authenticated;
grant execute on function public.get_driver_document_path(uuid) to authenticated;
grant execute on function public.get_driver_reminders() to authenticated;

-- -----------------------------------------------------------------------------
-- 10. Manager-side assignment reads
-- -----------------------------------------------------------------------------
/** Members holding the `driver` role, for the assignment picker. Managers only. */
create or replace function public.list_eligible_drivers()
returns table (
  member_id           uuid,
  user_id             uuid,
  email               text,
  full_name           text,
  assigned_vehicle_id uuid
)
language sql
stable
security definer
set search_path = ''
as $$
  select m.id,
         m.user_id,
         u.email::text,
         p.full_name,
         (select a.vehicle_id
            from public.driver_assignments a
           where a.driver_user_id = m.user_id
             and a.unassigned_at is null
           limit 1)
  from public.organization_members m
  join auth.users u on u.id = m.user_id
  left join public.profiles p on p.id = m.user_id
  where m.organization_id = public.current_org_id()
    and m.role = 'driver'
    and public.can_manage_driver_assignments()
  order by p.full_name nulls last, u.email;
$$;

comment on function public.list_eligible_drivers() is
  'Driver members of the caller''s own organization, with their current assignment if any. Owner/admin/fleet_manager only; takes no organization argument.';

/** Assignment history for one vehicle. Managers only. */
create or replace function public.get_vehicle_assignment_history(p_vehicle uuid)
returns table (
  id            uuid,
  driver_name   text,
  driver_email  text,
  assigned_at   timestamptz,
  unassigned_at timestamptz,
  note          text
)
language sql
stable
security definer
set search_path = ''
as $$
  select a.id,
         p.full_name,
         u.email::text,
         a.assigned_at,
         a.unassigned_at,
         a.note
  from public.driver_assignments a
  left join auth.users u on u.id = a.driver_user_id
  left join public.profiles p on p.id = a.driver_user_id
  where a.organization_id = public.current_org_id()
    and a.vehicle_id = p_vehicle
    and public.can_manage_driver_assignments()
  order by a.assigned_at desc;
$$;

comment on function public.get_vehicle_assignment_history(uuid) is
  'Assignment history for one vehicle in the caller''s own organization. Owner/admin/fleet_manager only. The organization is re-derived server-side, so a forged vehicle id from another organization returns nothing.';

revoke all on function public.list_eligible_drivers() from public, anon;
revoke all on function public.get_vehicle_assignment_history(uuid) from public, anon;
grant execute on function public.list_eligible_drivers() to authenticated;
grant execute on function public.get_vehicle_assignment_history(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- 11. Atomic assignment RPCs
-- -----------------------------------------------------------------------------
-- Reassignment must never transiently produce two active drivers for a vehicle
-- or two active vehicles for a driver. Both RPCs do all their work in one
-- transaction, and the partial unique indexes are the backstop if anything ever
-- reached the table by another path.
create or replace function public.assign_driver(
  p_vehicle uuid,
  p_member  uuid,
  p_note    text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org        uuid := public.current_org_id();
  v_actor      uuid := auth.uid();
  v_member_org uuid;
  v_member_role text;
  v_user       uuid;
  v_id         uuid;
begin
  if v_actor is null then
    return jsonb_build_object('state', 'not_authenticated');
  end if;
  if not public.can_manage_driver_assignments() then
    return jsonb_build_object('state', 'not_authorized');
  end if;

  -- The vehicle must belong to the CALLER'S organization, resolved server-side.
  -- A forged vehicle id from another organization simply fails this check.
  if not exists (
    select 1 from public.vehicles v
    where v.id = p_vehicle and v.organization_id = v_org and v.deleted_at is null
  ) then
    return jsonb_build_object('state', 'vehicle_not_found');
  end if;

  select m.organization_id, m.role, m.user_id
    into v_member_org, v_member_role, v_user
  from public.organization_members m
  where m.id = p_member;

  if v_member_org is null or v_member_org <> v_org then
    return jsonb_build_object('state', 'member_not_found');
  end if;
  if v_member_role <> 'driver' then
    return jsonb_build_object('state', 'not_a_driver');
  end if;

  -- Lock the vehicle row so two concurrent assignments to the same vehicle
  -- serialize rather than racing the partial unique index into an error.
  perform 1 from public.vehicles where id = p_vehicle for update;

  -- Close whatever is currently active on either side. Doing both before the
  -- insert is what makes replace/reassign atomic.
  update public.driver_assignments
     set unassigned_at = now()
   where organization_id = v_org
     and unassigned_at is null
     and (vehicle_id = p_vehicle or driver_user_id = v_user);

  insert into public.driver_assignments
    (organization_id, vehicle_id, member_id, driver_user_id, assigned_by, note)
  values (v_org, p_vehicle, p_member, v_user, v_actor, nullif(btrim(coalesce(p_note, '')), ''))
  returning id into v_id;

  return jsonb_build_object('state', 'ok', 'assignment_id', v_id);
end;
$$;

create or replace function public.unassign_driver(p_vehicle uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org   uuid := public.current_org_id();
  v_count integer;
begin
  if auth.uid() is null then
    return jsonb_build_object('state', 'not_authenticated');
  end if;
  if not public.can_manage_driver_assignments() then
    return jsonb_build_object('state', 'not_authorized');
  end if;

  update public.driver_assignments
     set unassigned_at = now()
   where organization_id = v_org
     and vehicle_id = p_vehicle
     and unassigned_at is null;

  get diagnostics v_count = row_count;
  -- Idempotent: unassigning an already-unassigned vehicle is a no-op, not an
  -- error, so a repeated request is safe.
  return jsonb_build_object('state', 'ok', 'ended', v_count);
end;
$$;

revoke all on function public.assign_driver(uuid, uuid, text) from public, anon;
revoke all on function public.unassign_driver(uuid) from public, anon;
grant execute on function public.assign_driver(uuid, uuid, text) to authenticated;
grant execute on function public.unassign_driver(uuid) to authenticated;

-- =============================================================================
-- End of migration
-- =============================================================================

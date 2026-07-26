-- =============================================================================
-- Vin.ID Fleet Lite — document intake / provenance audit
-- =============================================================================
-- Run AFTER applying 20260726120000_fleet_document_intake.sql.
--
-- Every query below is a DETECTION query: each must return ZERO ROWS. Nothing
-- here mutates data.
--
-- The invariant this audit exists to defend is the product's core safety rule:
--
--     upload -> extract -> review/edit -> EXPLICIT confirm -> persistence
--
-- Checks 1-4 are the database-side statement of "no operational record before
-- explicit confirmation, exactly one record per confirmation, and the model's
-- original output is never destroyed".
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. No operational record may exist for an UNCONFIRMED intake.
--    Walks from every non-confirmed intake to any record carrying its document,
--    which is the shape an "auto-created before confirmation" bug would take.
--    Records created by the OTHER source paths (manual entry, private scan) are
--    excluded by source_type — they are not intake output.
--    Expected: 0 rows.
-- -----------------------------------------------------------------------------
select e.id as extraction_id, e.status, r.record_id, r.kind,
       'operational record exists for an unconfirmed intake' as defect
from public.document_extractions e
join lateral (
  select m.id as record_id, 'maintenance' as kind from public.maintenance_logs m
   where m.document_id = e.document_id and m.source_type = 'fleet_intake'
  union all
  select i.id, 'insurance' from public.vehicle_insurance i
   where i.document_id = e.document_id and i.source_type = 'fleet_intake'
  union all
  select g.id, 'registration' from public.vehicle_registration g
   where g.document_id = e.document_id and g.source_type = 'fleet_intake'
  union all
  select n.id, 'inspection' from public.vehicle_inspection n
   where n.document_id = e.document_id and n.source_type = 'fleet_intake'
) r on true
where e.source = 'fleet_intake'
  and e.status <> 'confirmed';


-- -----------------------------------------------------------------------------
-- 2. A confirmed intake must carry full provenance.
--    Who confirmed it, when, which record it produced, and under which
--    category. A confirmed row missing any of these cannot be audited later.
--    Legacy rows from the pre-Fleet metadata flow are excluded by source.
--    Expected: 0 rows.
-- -----------------------------------------------------------------------------
select id as extraction_id,
       case
         when created_record_id is null   then 'no created_record_id'
         when created_record_type is null then 'no created_record_type'
         when confirmed_by is null        then 'no confirmed_by'
         when confirmed_at is null        then 'no confirmed_at'
         when confirmed_category is null  then 'no confirmed_category'
         when confirmed_data is null      then 'no confirmed_data'
       end as defect
from public.document_extractions
where source = 'fleet_intake'
  and status = 'confirmed'
  and (created_record_id is null or created_record_type is null
       or confirmed_by is null or confirmed_at is null
       or confirmed_category is null or confirmed_data is null);


-- -----------------------------------------------------------------------------
-- 3. The model's ORIGINAL output must survive confirmation.
--    User corrections belong in confirmed_data; extracted_data is the record of
--    what was actually proposed and must never be emptied or replaced by it.
--    Expected: 0 rows.
-- -----------------------------------------------------------------------------
select id as extraction_id,
       'extracted_data lost or overwritten by the confirmed values' as defect
from public.document_extractions
where source = 'fleet_intake'
  and status = 'confirmed'
  and (extracted_data is null
       or extracted_data = '{}'::jsonb
       or extracted_data = confirmed_data);


-- -----------------------------------------------------------------------------
-- 4. One confirmation must produce exactly ONE operational record.
--    Counts every intake-sourced record sharing a confirmed intake's document.
--    More than one means a duplicate slipped through the confirmation lock.
--    Expected: 0 rows.
-- -----------------------------------------------------------------------------
select e.id as extraction_id, count(r.record_id) as records,
       'confirmation produced more than one operational record' as defect
from public.document_extractions e
join lateral (
  select m.id as record_id from public.maintenance_logs m
   where m.document_id = e.document_id and m.source_type = 'fleet_intake'
  union all
  select i.id from public.vehicle_insurance i
   where i.document_id = e.document_id and i.source_type = 'fleet_intake'
  union all
  select g.id from public.vehicle_registration g
   where g.document_id = e.document_id and g.source_type = 'fleet_intake'
  union all
  select n.id from public.vehicle_inspection n
   where n.document_id = e.document_id and n.source_type = 'fleet_intake'
) r on true
where e.source = 'fleet_intake' and e.status = 'confirmed'
group by e.id
having count(r.record_id) > 1;


-- -----------------------------------------------------------------------------
-- 5. Tenant integrity: an intake, its document, its vehicle and the record it
--    produced must all sit in the SAME organization.
--    Expected: 0 rows.
-- -----------------------------------------------------------------------------
select e.id as extraction_id, 'organization mismatch across the intake chain' as defect
from public.document_extractions e
left join public.vehicle_documents d on d.id = e.document_id
left join public.vehicles v on v.id = e.vehicle_id
where (d.id is not null and d.organization_id is distinct from e.organization_id)
   or (v.id is not null and v.organization_id is distinct from e.organization_id);


-- -----------------------------------------------------------------------------
-- 6. The intake RPCs must be SECURITY DEFINER with a pinned search_path, and
--    must not be executable anonymously.
--    Expected: 0 rows.
-- -----------------------------------------------------------------------------
with expected(fn) as (
  select unnest(array[
    'confirm_fleet_intake', 'match_fleet_vehicles', 'find_duplicate_documents'
  ])
)
select e.fn as function_name,
       'missing, not SECURITY DEFINER, or search_path not pinned' as defect
from expected e
where not exists (
  select 1 from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = e.fn
    and p.prosecdef = true
    and coalesce(array_to_string(p.proconfig, ','), '') like '%search_path=%'
)
union all
select p.proname, 'intake RPC is reachable anonymously'
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
join pg_roles r on r.oid = acl.grantee
where n.nspname = 'public'
  and acl.privilege_type = 'EXECUTE'
  and r.rolname in ('anon', 'public')
  and p.proname in ('confirm_fleet_intake', 'match_fleet_vehicles',
                    'find_duplicate_documents');


-- -----------------------------------------------------------------------------
-- 7. Cost must be counted exactly once.
--    Fleet cost totals come from maintenance_logs.cost attributed by
--    performed_at; vehicle_documents.amount is deliberately NOT summed (see
--    docs/fleet-lite-fleet-manager.md). This flags an intake-created maintenance
--    record whose document carries a DIFFERENT amount, which would mean the two
--    numbers have drifted and one of them is wrong.
--    Expected: 0 rows.
-- -----------------------------------------------------------------------------
select m.id as maintenance_id, m.cost, d.amount,
       'intake maintenance cost disagrees with its document amount' as defect
from public.maintenance_logs m
join public.vehicle_documents d on d.id = m.document_id
where m.source_type = 'fleet_intake'
  and m.deleted_at is null
  and m.cost is not null
  and d.amount is not null
  and m.cost <> d.amount;


-- -----------------------------------------------------------------------------
-- 8. Raw extraction must stay out of the Passport.
--    Passport snapshots are public-facing once shared, so no snapshot may carry
--    OCR text, extraction internals or a Storage path.
--    Expected: 0 rows.
-- -----------------------------------------------------------------------------
select id as passport_id, 'passport snapshot contains extraction internals' as defect
from public.vehicle_passports
where snapshot::text ~* '(raw_text|extracted_data|field_provenance|storage_path|category_confidence)';


-- -----------------------------------------------------------------------------
-- 9. Negative costs must not exist on intake-created records.
--    Expected: 0 rows.
-- -----------------------------------------------------------------------------
select 'maintenance' as kind, id::text, cost, 'negative cost' as defect
from public.maintenance_logs where source_type = 'fleet_intake' and cost < 0
union all
select 'insurance', id::text, cost, 'negative cost'
from public.vehicle_insurance where source_type = 'fleet_intake' and cost < 0
union all
select 'inspection', id::text, cost, 'negative cost'
from public.vehicle_inspection where source_type = 'fleet_intake' and cost < 0;

-- =============================================================================
-- End of audit
-- =============================================================================

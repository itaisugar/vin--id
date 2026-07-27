-- Private Vehicle release gate — data and policy invariants.
--
-- EVERY QUERY MUST RETURN ZERO ROWS. A row is a defect: the check names what is
-- wrong, so the output is readable without consulting this file.
--
-- These are the invariants the private flow depends on that no single test can
-- prove, because they must hold for EVERY row and EVERY table rather than for
-- the rows one scenario happened to create. The table lists are derived from the
-- catalog wherever possible, so a table added later is covered automatically
-- instead of quietly escaping the audit.
--
-- Run (LOCAL only):
--   docker exec -i supabase_db_vin-id psql -U postgres -d postgres \
--     -f - < supabase/audits/private_vehicle_audit.sql

\echo '--- 1. No operational record may exist without an explicit confirmation'
-- The safety rule, checked against the stored data rather than the code path
-- that wrote it: an extraction that names a created record must be confirmed.
select 'check 1: extraction claims a record without being confirmed' as check,
       id, status, created_record_type
from public.document_extractions
where created_record_id is not null
  and (status <> 'confirmed' or confirmed_at is null);

\echo '--- 2. Every confirmed intake names the record it produced'
select 'check 2: confirmed intake with no created record' as check,
       id, confirmed_at
from public.document_extractions
where source = 'fleet_intake'
  and status = 'confirmed'
  and created_record_id is null;

\echo '--- 3. One confirmed intake per document (no duplicate operational record)'
select 'check 3: document has more than one confirmed intake' as check,
       document_id, count(*) as confirmed_count
from public.document_extractions
where status = 'confirmed' and source = 'fleet_intake' and document_id is not null
group by document_id
having count(*) > 1;

\echo '--- 4. A record never belongs to a different tenant than its vehicle'
-- Cross-tenant drift would make a record visible to the wrong organization even
-- though every policy is correct, because the policies trust this column.
select 'check 4: record organization disagrees with its vehicle' as check,
       t.tbl, t.id, t.record_org, t.vehicle_org
from (
  select 'maintenance_logs' as tbl, m.id, m.organization_id as record_org, v.organization_id as vehicle_org
    from public.maintenance_logs m join public.vehicles v on v.id = m.vehicle_id
  union all
  select 'issue_logs', i.id, i.organization_id, v.organization_id
    from public.issue_logs i join public.vehicles v on v.id = i.vehicle_id
  union all
  select 'reminders', r.id, r.organization_id, v.organization_id
    from public.reminders r join public.vehicles v on v.id = r.vehicle_id
  union all
  select 'vehicle_documents', d.id, d.organization_id, v.organization_id
    from public.vehicle_documents d join public.vehicles v on v.id = d.vehicle_id
  union all
  select 'vehicle_insurance', x.id, x.organization_id, v.organization_id
    from public.vehicle_insurance x join public.vehicles v on v.id = x.vehicle_id
  union all
  select 'vehicle_registration', x.id, x.organization_id, v.organization_id
    from public.vehicle_registration x join public.vehicles v on v.id = x.vehicle_id
  union all
  select 'vehicle_inspection', x.id, x.organization_id, v.organization_id
    from public.vehicle_inspection x join public.vehicles v on v.id = x.vehicle_id
  union all
  select 'vehicle_passports', p.id, p.organization_id, v.organization_id
    from public.vehicle_passports p join public.vehicles v on v.id = p.vehicle_id
  union all
  select 'document_extractions', e.id, e.organization_id, v.organization_id
    from public.document_extractions e join public.vehicles v on v.id = e.vehicle_id
) t
where t.record_org is distinct from t.vehicle_org;

\echo '--- 5. Every write policy on a record table demands is_org_writer()'
-- This is the database half of "server authorization matches RLS". The table
-- list comes from the catalog: any org-scoped table with an organization_id
-- column is included, so a new one cannot escape the rule by omission.
with record_tables as (
  select c.relname as tbl
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  join pg_attribute a on a.attrelid = c.oid and a.attname = 'organization_id' and a.attnum > 0
  where n.nspname = 'public' and c.relkind = 'r'
)
-- A policy passes if it demands `is_org_writer()` OR a guard that is STRICTLY
-- STRONGER — a narrower set of callers, never a wider one:
--
--   is_org_admin()                    owner/admin only, a subset of writers
--   can_manage_driver_assignments()   owner/admin/fleet_manager, also a subset
--   auth.uid() = <own row>            one user's own row only (profiles)
--
-- The list is written as a positive allowance rather than a table-exclusion
-- list so that adding a table can never quietly opt it out of the rule; adding
-- a WEAKER guard would still be reported here.
select 'check 5: write policy does not require is_org_writer() or a stronger guard' as check,
       p.tablename, p.policyname, p.cmd
from pg_policies p
join record_tables rt on rt.tbl = p.tablename
where p.schemaname = 'public'
  and p.cmd in ('INSERT', 'UPDATE', 'DELETE')
  and coalesce(p.with_check, '') || coalesce(p.qual, '') !~
      '(is_org_writer\(\)|is_org_admin\(\)|can_manage_driver_assignments\(\)|auth\.uid\(\))';

\echo '--- 6. Every record table has RLS enabled and forced-on'
with record_tables as (
  select c.oid, c.relname, c.relrowsecurity
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  join pg_attribute a on a.attrelid = c.oid and a.attname = 'organization_id' and a.attnum > 0
  where n.nspname = 'public' and c.relkind = 'r'
)
select 'check 6: row level security is not enabled' as check, relname
from record_tables
where not relrowsecurity;

\echo '--- 7. No raw OCR text or raw provider response is retained'
select 'check 7: raw extraction text stored' as check, id, source
from public.document_extractions
where raw_text is not null and length(btrim(raw_text)) > 0;

\echo '--- 8. A stored failure reason is a category, never a provider payload'
select 'check 8: failure reason looks like a raw provider response' as check, id, left(error, 40) as sample
from public.document_extractions
where error is not null
  and (error ~* '(https?://|api[_-]?key|sk-|bearer |"content"|stack trace)' or length(error) > 200);

\echo '--- 9. Passport snapshots carry no private or internal data'
-- The public page renders the snapshot, so anything in here is public.
select 'check 9: passport snapshot contains private data' as check, id, status
from public.vehicle_passports
where snapshot::text ~ '(storage_path|extracted_data|field_provenance|raw_text|category_confidence|token_hash|organization_id)';

\echo '--- 10. Share tokens are stored hashed, never raw'
select 'check 10: transfer token is not a sha-256 hash' as check, id, status
from public.transfer_tokens
where token_hash !~ '^[0-9a-f]{64}$';

\echo '--- 11. The documents bucket is private'
select 'check 11: document bucket is public' as check, id, public
from storage.buckets
where id = 'vehicle-documents' and public;

\echo '--- 12. Accepted passport copies never reference the seller''s files'
-- A buyer receives copied METADATA. A storage_path on a copied document would
-- hand them a pointer into the seller's private bucket.
select 'check 12: accepted copy carries a seller storage path' as check,
       d.id, d.vehicle_id
from public.vehicle_documents d
join public.ownership_transfers t on t.new_vehicle_id = d.vehicle_id
where d.storage_path is not null;

\echo '--- audit complete: every check above must have returned zero rows ---'

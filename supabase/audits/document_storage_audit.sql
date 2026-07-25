-- =============================================================================
-- Vin.ID Fleet Lite — document Storage security audit
-- =============================================================================
-- Run in the Supabase SQL Editor AFTER applying
--   20260725120000_document_storage_org_access.sql
--
-- Every query below is a DETECTION query: each must return ZERO ROWS. Nothing
-- here mutates data.
--
-- NOTE on what is deliberately NOT flagged: a `vehicle_documents` row with a
-- NULL storage_path is NORMAL — passport-accepted copies are metadata-only
-- (accept_passport sets storage_path = NULL) and records may exist without a
-- file. So "missing storage_path" is not an error and is not checked.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. The documents bucket must stay PRIVATE. Expected: 0 rows.
-- -----------------------------------------------------------------------------
select id, public
from storage.buckets
where id = 'vehicle-documents'
  and public is distinct from false;


-- -----------------------------------------------------------------------------
-- 2. No permissive/blanket Storage policy on the bucket.
--    Flags any policy on storage.objects that is applicable to anon/public, OR
--    whose predicate is unconditional (USING true) — i.e. does not go through
--    the org-aware helpers or the bucket + owner checks.
--    Expected: 0 rows.
-- -----------------------------------------------------------------------------
select policyname, cmd, roles::text, qual::text, with_check::text
from pg_policies
where schemaname = 'storage'
  and tablename = 'objects'
  and policyname like 'vehicle_documents_objects_%'
  and (
    -- reachable by anonymous callers
    (roles::text[] && array['public', 'anon'])
    -- or missing the bucket guard
    or coalesce(qual::text, '') || coalesce(with_check::text, '') not like '%vehicle-documents%'
    -- or a read/write policy that does not consult the org-aware predicate
    or (cmd in ('SELECT', 'DELETE')
        and coalesce(qual::text, '') not like '%can_%_document_object%')
  );


-- -----------------------------------------------------------------------------
-- 3. A document's organization must match its vehicle's organization.
--    (Storage authorization joins on the document row's org, so a mismatch here
--    would be a real cross-tenant hazard.) Expected: 0 rows.
-- -----------------------------------------------------------------------------
select d.id as document_id, d.organization_id as doc_org, v.organization_id as vehicle_org
from public.vehicle_documents d
join public.vehicles v on v.id = d.vehicle_id
where d.organization_id is distinct from v.organization_id;


-- -----------------------------------------------------------------------------
-- 4. No two DISTINCT, live documents point at the same Storage object.
--    A shared object would let one document's deletion pull the file from under
--    another. (Passport copies use NULL storage_path, so they are excluded.)
--    Expected: 0 rows.
-- -----------------------------------------------------------------------------
select storage_path, count(*) as refs
from public.vehicle_documents
where storage_path is not null
  and deleted_at is null
group by storage_path
having count(*) > 1;


-- -----------------------------------------------------------------------------
-- 5. Every live document object path must be uploader-prefixed
--    ({uploader_uid}/...). This is the format the upload + createDocument guard
--    enforce; a row that does not match indicates tampering or a stray legacy
--    format that the org-aware policies were not designed around.
--    Expected: 0 rows.
-- -----------------------------------------------------------------------------
select id, owner_user_id, storage_path
from public.vehicle_documents
where storage_path is not null
  and deleted_at is null
  and storage_path not like owner_user_id::text || '/%';


-- -----------------------------------------------------------------------------
-- 6. The org-aware authorization helpers exist and are SECURITY DEFINER.
--    Expected: 0 rows (i.e. none missing / mis-defined).
-- -----------------------------------------------------------------------------
with expected(fn) as (
  select unnest(array['can_read_document_object', 'can_write_document_object'])
)
select e.fn as helper_missing_or_not_security_definer
from expected e
where not exists (
  select 1 from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = e.fn
    and p.prosecdef = true
);

-- =============================================================================
-- End of audit
-- =============================================================================

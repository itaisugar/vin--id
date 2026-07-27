-- =============================================================================
-- Vin.ID Fleet Lite — organization-aware document Storage access
-- =============================================================================
-- PROBLEM (Fleet Lite known limitation): document FILES live in the private
-- `vehicle-documents` bucket under the path
--
--     {uploader_user_id}/{vehicle_id}/{document_id}/{filename}
--
-- and the Storage policies (migration 20260607170001) gate every object on
-- `(storage.foldername(name))[1] = auth.uid()` — the UPLOADER's id. Signed URLs
-- are created under the caller's JWT, so another authorized member of the same
-- organization (a different auth.uid) is blocked from opening the file even
-- though they can see the document metadata row.
--
-- FIX (chosen design — see docs/fleet-lite-document-storage.md): authorize
-- Storage access by the DOCUMENT ROW, not by the path prefix. A member may
-- read an object iff their organization owns a (non-deleted) `vehicle_documents`
-- row whose `storage_path` equals the object name. Writers may replace/remove
-- it. This:
--   * lets any authorized org member open the file (the actual requirement),
--   * keeps strict cross-org isolation (the join is org-scoped),
--   * needs NO service-role key (consistent with this codebase, which uses
--     SECURITY DEFINER helpers instead — see current_org_id / is_org_writer),
--   * needs NO object migration: the path format is unchanged, so every legacy
--     file keeps working (authorization no longer depends on the path prefix),
--   * is forward-compatible with a future organization_members table — only the
--     org-resolution helpers change, not this policy.
--
-- The bucket stays PRIVATE. Files are still served only through short-lived
-- signed URLs generated server-side after `getDocument` (org-scoped) authorizes.
-- Uploads remain uid-prefixed (the row does not exist yet at INSERT time), so a
-- caller can still only write under their own prefix — now additionally gated on
-- being a writer, so viewers cannot write objects.
--
-- This migration does NOT edit the already-deployed 20260607170001; it drops
-- that migration's policies by name and installs the org-aware set. Idempotent.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Index the join key. The Storage policies below match objects to document
--    rows on `storage_path`, so this must be fast.
-- -----------------------------------------------------------------------------
create index if not exists vehicle_documents_storage_path_idx
  on public.vehicle_documents (storage_path)
  where storage_path is not null;

-- -----------------------------------------------------------------------------
-- 2. Authorization helpers (SECURITY DEFINER, like current_org_id/is_org_writer).
--    They answer "may the current user READ / WRITE the object at this path?"
--    purely from the document row + the caller's organization — never from the
--    path string itself.
-- -----------------------------------------------------------------------------

-- READ: any member of the org that owns a live document row for this object.
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
  );
$$;

comment on function public.can_read_document_object(text) is
  'True when the current user''s organization owns a non-deleted vehicle_documents row for this Storage object. Authorizes reads by the document row, not the path prefix.';

-- WRITE: an org WRITER (owner/admin/fleet_manager) whose org owns a document row
-- for this object. No deleted_at filter, so a writer can still remove the object
-- immediately after the metadata row was soft-deleted.
create or replace function public.can_write_document_object(p_object_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_org_writer()
     and exists (
       select 1
       from public.vehicle_documents d
       where d.storage_path = p_object_name
         and d.organization_id = public.current_org_id()
     );
$$;

comment on function public.can_write_document_object(text) is
  'True when the current user is an org writer and their organization owns a vehicle_documents row for this Storage object (any deleted_at). Authorizes object replace/remove.';

grant execute on function public.can_read_document_object(text)  to authenticated;
grant execute on function public.can_write_document_object(text) to authenticated;

-- -----------------------------------------------------------------------------
-- 3. Replace the uid-scoped object policies with org-aware ones.
--    The bucket remains private (unchanged); only the access predicate changes.
-- -----------------------------------------------------------------------------

-- Drop the old uid-scoped policies from 20260607170001.
drop policy if exists "vehicle_documents_objects_select_own" on storage.objects;
drop policy if exists "vehicle_documents_objects_insert_own" on storage.objects;
drop policy if exists "vehicle_documents_objects_update_own" on storage.objects;
drop policy if exists "vehicle_documents_objects_delete_own" on storage.objects;

-- Drop this migration's own policies too, so re-running is clean.
drop policy if exists "vehicle_documents_objects_read_org"   on storage.objects;
drop policy if exists "vehicle_documents_objects_insert_org" on storage.objects;
drop policy if exists "vehicle_documents_objects_update_org" on storage.objects;
drop policy if exists "vehicle_documents_objects_delete_org" on storage.objects;

-- READ: authorized org members (includes viewers — read-only is allowed).
create policy "vehicle_documents_objects_read_org" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'vehicle-documents'
    and public.can_read_document_object(name)
  );

-- INSERT: the document row does not exist yet, so authorize by prefix (the
-- caller may only write under their own uid) AND require writer role, so a
-- viewer cannot place objects in the bucket at all.
create policy "vehicle_documents_objects_insert_org" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'vehicle-documents'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and public.is_org_writer()
  );

-- UPDATE (replace): org writer whose org owns the document row.
create policy "vehicle_documents_objects_update_org" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'vehicle-documents'
    and public.can_write_document_object(name)
  )
  with check (
    bucket_id = 'vehicle-documents'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and public.is_org_writer()
  );

-- DELETE (remove object): org writer whose org owns the document row.
create policy "vehicle_documents_objects_delete_org" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'vehicle-documents'
    and public.can_write_document_object(name)
  );

-- -----------------------------------------------------------------------------
-- 4. Harden vehicle_documents WRITE policies: the referenced vehicle must live
--    in the caller's organization.
--
--    The Phase 1 generic policies (20260722120000) check only
--    `organization_id = current_org_id() and is_org_writer()`. Because a row's
--    organization_id is auto-derived from the inserter's own profile, a writer
--    could otherwise create a document row that references ANOTHER org's vehicle
--    (the row lands in the writer's own org, so it is not a data leak, but it is
--    a cross-org-inconsistent row and defeats "forged vehicle IDs are
--    rejected"). The application layer already blocks this via the org-scoped
--    getVehicleById; these policies add the same guard at the database layer so
--    a direct client insert is rejected too.
--
--    Scoped to vehicle_documents (this task's domain). accept_passport is
--    SECURITY DEFINER and bypasses RLS, so passport copies are unaffected.
-- -----------------------------------------------------------------------------
drop policy if exists "vehicle_documents_insert_org" on public.vehicle_documents;
create policy "vehicle_documents_insert_org" on public.vehicle_documents
  for insert with check (
    organization_id = public.current_org_id()
    and public.is_org_writer()
    and exists (
      select 1 from public.vehicles v
      where v.id = vehicle_id
        and v.organization_id = public.current_org_id()
    )
  );

drop policy if exists "vehicle_documents_update_org" on public.vehicle_documents;
create policy "vehicle_documents_update_org" on public.vehicle_documents
  for update
  using (
    organization_id = public.current_org_id()
    and public.is_org_writer()
  )
  with check (
    organization_id = public.current_org_id()
    and public.is_org_writer()
    and exists (
      select 1 from public.vehicles v
      where v.id = vehicle_id
        and v.organization_id = public.current_org_id()
    )
  );

-- =============================================================================
-- End of migration
-- =============================================================================

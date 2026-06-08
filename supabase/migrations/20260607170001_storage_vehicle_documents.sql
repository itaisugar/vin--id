-- =============================================================================
-- Vin.ID — Phase 2E: private Storage bucket "vehicle-documents" + RLS policies
-- =============================================================================
-- Creates a PRIVATE bucket for vehicle document files and restricts every
-- object operation to the owner, based on the first path segment being the
-- user's id. Path convention:
--
--   {user_id}/{vehicle_id}/{document_id}/{safe_filename}
--
-- The bucket is private (public = false); files are only ever served through
-- short-lived signed URLs generated server-side. File type/size are also
-- enforced at the bucket level as defense in depth (5 MB; pdf/jpeg/png/webp).
--
-- Run this in the Supabase SQL Editor (as the postgres role). It is idempotent.
-- =============================================================================

-- 1. Private bucket with size/type limits.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'vehicle-documents',
  'vehicle-documents',
  false,
  5242880, -- 5 MB
  array['application/pdf', 'image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- 2. Owner-only object policies. The first folder in the object name must equal
--    the authenticated user's id. RLS on storage.objects is already enabled by
--    Supabase; these policies scope it to this bucket.
drop policy if exists "vehicle_documents_objects_select_own" on storage.objects;
create policy "vehicle_documents_objects_select_own" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'vehicle-documents'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "vehicle_documents_objects_insert_own" on storage.objects;
create policy "vehicle_documents_objects_insert_own" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'vehicle-documents'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "vehicle_documents_objects_update_own" on storage.objects;
create policy "vehicle_documents_objects_update_own" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'vehicle-documents'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  )
  with check (
    bucket_id = 'vehicle-documents'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "vehicle_documents_objects_delete_own" on storage.objects;
create policy "vehicle_documents_objects_delete_own" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'vehicle-documents'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

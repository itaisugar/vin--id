-- Private Vehicle release gate — make the phase 6 upgrade survive real legacy
-- data.
--
-- WHY THE TIMESTAMP IS EARLIER THAN THE MIGRATIONS WRITTEN BEFORE IT. This file
-- was written during the Private Vehicle gate, after 20260726120000, but it must
-- RUN BEFORE it, so it is numbered accordingly. Migrations are ordered by
-- version, not by authorship date, and 20260726120000 has never been applied to
-- any deployed environment — it only exists on this branch — so nothing that has
-- already run is being rewritten.
--
-- THE FAILURE THIS FIXES, reproduced against a real legacy chain:
--
--   ERROR: could not create unique index
--          "document_extractions_one_confirmed_per_document"
--   DETAIL: Key (document_id)=(…) is duplicated.
--
-- 20260726120000 creates a unique index over `(document_id) where status =
-- 'confirmed'`. That is sound for Fleet intake, which it was written for, but
-- the table already holds rows from the older document-METADATA flow, and that
-- flow legitimately produces several confirmed rows for one document: re-reading
-- a document and confirming it again is an ordinary edit, and `runExtraction()`
-- only ever cleared PENDING rows. Any user who did that twice leaves a duplicate
-- pair behind, and the migration aborts on it — so the phase 6 deployment fails
-- against exactly the production data it was written to serve.
--
-- Found by the legacy-upgrade gate (a pre-phase-6 chain, seeded with two
-- confirmed metadata extractions for one document, then upgraded). A clean
-- database never hits it, which is why it survived until an upgrade was tested.

-- ---------------------------------------------------------------------------
-- 1. Allow the terminal states the newer flow uses
-- ---------------------------------------------------------------------------

-- `superseded` and `cancelled` arrive with 20260726120000. They are needed here,
-- one step earlier, to describe what happened to the older duplicates. The
-- constraint 20260726120000 installs afterwards is the same set.
alter table public.document_extractions
  drop constraint if exists document_extractions_status_check;
alter table public.document_extractions
  add constraint document_extractions_status_check
  check (status in (
    'pending_confirmation', 'confirmed', 'discarded', 'failed',
    'cancelled', 'superseded'
  ));

-- ---------------------------------------------------------------------------
-- 2. Keep the newest confirmation per document; mark the rest superseded
-- ---------------------------------------------------------------------------

-- NOTHING IS DELETED. Every row keeps its `extracted_data`, its
-- `confirmed_data` and its timestamps — only `status` changes, from 'confirmed'
-- to 'superseded', which is the truthful description: a later confirmation of
-- the same document replaced it. The document metadata these rows wrote lives on
-- `vehicle_documents` and is untouched, so no user-visible value is lost.
--
-- "Newest" is decided by confirmed_at, then created_at, then id, so the choice
-- is total and deterministic — re-running this picks the same survivor.
with ranked as (
  select id,
         row_number() over (
           partition by document_id
           order by confirmed_at desc nulls last, created_at desc, id desc
         ) as rn
  from public.document_extractions
  where status = 'confirmed'
    and document_id is not null
)
update public.document_extractions e
   set status = 'superseded'
  from ranked r
 where r.id = e.id
   and r.rn > 1;

comment on column public.document_extractions.status is
  'pending_confirmation | confirmed | discarded | failed | cancelled | superseded. At most one confirmed row per document survives; older confirmations of the same document are superseded, never deleted.';

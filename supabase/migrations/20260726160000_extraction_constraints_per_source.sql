-- Private Vehicle release gate — fix two regressions that
-- 20260726120000_fleet_document_intake.sql introduced into the DOCUMENT
-- METADATA extraction flow (the "Extract with AI" button on a document's own
-- page, source = 'document_metadata').
--
-- That flow predates Fleet intake, is still linked from the document detail
-- screen, and is a normal private-user action. Phase 6 reasoned about its
-- pre-existing ROWS (exempted with NOT VALID) but not about the fact that the
-- flow still RUNS and produces new confirmed rows. Both regressions below were
-- reproduced against a clean local database before this migration was written.
--
-- REGRESSION 1 — every metadata confirmation raised
--   new row for relation "document_extractions" violates check constraint
--   "document_extractions_confirmed_has_record"
-- because `document_extractions_confirmed_has_record` demanded that ANY
-- confirmed row name an operational record. A metadata confirmation
-- legitimately produces none: it writes six fields onto vehicle_documents.
--
-- REGRESSION 2 — `document_extractions_one_confirmed_per_document` allowed only
-- one confirmed extraction per document ever, so re-reading a document and
-- confirming it a second time failed on a unique violation. For Fleet intake
-- that index is a deliberate idempotency backstop; for metadata it forbids a
-- legal, repeatable edit.
--
-- THE SAFETY RULE IS NOT WEAKENED. The direction that protects the user is
--
--     created_record_id is not null  =>  the row is confirmed
--
-- i.e. an operational record can never be claimed by an unconfirmed extraction.
-- That implication is kept for EVERY source, unchanged. What is scoped to
-- Fleet intake is the converse completeness rule (`confirmed => has a record`),
-- which only ever made sense for the source that creates operational records.

-- ---------------------------------------------------------------------------
-- 1. Confirmation/record coupling, stated per source
-- ---------------------------------------------------------------------------

alter table public.document_extractions
  drop constraint if exists document_extractions_confirmed_has_record;

alter table public.document_extractions
  add constraint document_extractions_confirmed_has_record
  check (
    -- (a) PROTECTIVE DIRECTION, all sources: naming a created record requires an
    --     explicit confirmation. This is the database-level statement of "no
    --     final record before explicit user confirmation".
    (
      created_record_id is null
      or (status = 'confirmed' and confirmed_at is not null)
    )
    and
    -- (b) COMPLETENESS, Fleet intake only: confirm_fleet_intake() must always
    --     record which operational record it produced, so a confirmed intake
    --     can never lose its provenance link.
    (
      source <> 'fleet_intake'
      or status <> 'confirmed'
      or (created_record_id is not null and confirmed_at is not null)
    )
  )
  -- Still NOT VALID: legacy confirmed metadata rows predate `confirmed_at`
  -- being written consistently. Every new and updated row is checked.
  not valid;

comment on constraint document_extractions_confirmed_has_record
  on public.document_extractions is
  'No final record before explicit confirmation: created_record_id implies status=confirmed (all sources). Fleet intake additionally must always name the record it created.';

-- ---------------------------------------------------------------------------
-- 2. Idempotency backstop, scoped to the flow it backs up
-- ---------------------------------------------------------------------------

-- Fleet intake creates operational records, so "at most one confirmed
-- extraction per document" is what stops a bypassed row lock from producing a
-- second maintenance log. Metadata confirmation creates no operational record —
-- re-reading a document and confirming again is an ordinary edit, and the
-- second confirmation supersedes the first rather than duplicating anything.
drop index if exists public.document_extractions_one_confirmed_per_document;

create unique index if not exists document_extractions_one_confirmed_intake_per_document
  on public.document_extractions (document_id)
  where status = 'confirmed' and source = 'fleet_intake';

comment on index public.document_extractions_one_confirmed_intake_per_document is
  'Idempotency backstop for confirm_fleet_intake(): at most one confirmed intake per document, so even a bypassed row lock cannot create a second operational record.';

-- ---------------------------------------------------------------------------
-- 3. `issue` is a record type an extraction can produce
-- ---------------------------------------------------------------------------

-- The "Scan a document" flow can classify a document as a fault report and
-- create an issue_logs row. Phase 6 listed only the four record types Fleet
-- intake creates, so a scan-sourced provenance row had no honest way to say what
-- it produced. Fleet intake itself is unaffected: confirm_fleet_intake() never
-- writes 'issue'.
alter table public.document_extractions
  drop constraint if exists document_extractions_record_type_check;
alter table public.document_extractions
  add constraint document_extractions_record_type_check
  check (created_record_type is null or created_record_type in (
    'maintenance', 'insurance', 'registration', 'inspection', 'issue'
  ));

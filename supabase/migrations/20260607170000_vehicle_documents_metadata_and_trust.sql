-- =============================================================================
-- Vin.ID — Phase 2E: vehicle_documents — metadata columns + trust vocabulary
-- =============================================================================
-- The Phase 2A base schema stored only basic file metadata (storage_path,
-- file_name, mime_type, file_size, doc_type) and an old 3-value trust_label.
-- Phase 2E adds document metadata (dates, vendor, amount, privacy flags) and
-- aligns trust_label to the product vocabulary (default 'document_backed').
--
-- Safe to run on the existing database: vehicle_documents has no rows yet, so
-- the new CHECK constraint validates cleanly.
-- =============================================================================

alter table public.vehicle_documents
  add column if not exists document_date date;

alter table public.vehicle_documents
  add column if not exists expiry_date date;

alter table public.vehicle_documents
  add column if not exists vendor text;

alter table public.vehicle_documents
  add column if not exists amount numeric(12, 2)
    check (amount is null or amount >= 0);

alter table public.vehicle_documents
  add column if not exists currency text not null default 'ILS';

-- Privacy flags. Documents may contain personal info; default to the cautious
-- value (true) and keep sharing opt-in (false).
alter table public.vehicle_documents
  add column if not exists contains_personal_info boolean not null default true;

alter table public.vehicle_documents
  add column if not exists share_allowed boolean not null default false;

-- Trust vocabulary (matches maintenance_logs / issue_logs). Documents default
-- to 'document_backed' since they are backed by an uploaded file.
alter table public.vehicle_documents
  alter column trust_label set default 'document_backed';

alter table public.vehicle_documents
  drop constraint if exists vehicle_documents_trust_label_check;

alter table public.vehicle_documents
  add constraint vehicle_documents_trust_label_check
  check (
    trust_label in (
      'user_entered',
      'document_backed',
      'ai_extracted',
      'mechanic_verified',
      'external_source'
    )
  );

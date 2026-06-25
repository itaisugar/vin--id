-- =============================================================================
-- Vin.ID — Scan persistence: link a scan-created record to its saved document
-- =============================================================================
-- The "Scan a document" flow now SAVES the uploaded image as a vehicle document
-- (via the existing vehicle_documents pipeline) and links the created record to
-- it so it can be opened later from the vehicle history ("View document").
--
-- This adds a nullable FK `document_id` to every table the scan flow writes to:
-- maintenance_logs, issue_logs, and the three category tables vehicle_insurance
-- / vehicle_registration / vehicle_inspection. On document delete the link is
-- cleared (the record itself is kept) — same convention as
-- issue_logs.diagnosis_session_id.
--
-- Additive, nullable, no backfill. Does not alter existing columns or RLS.
-- Safe to run on the existing database (IF NOT EXISTS, idempotent).
-- =============================================================================

alter table public.maintenance_logs
  add column if not exists document_id uuid
    references public.vehicle_documents(id) on delete set null;
create index if not exists maintenance_logs_document_id_idx
  on public.maintenance_logs (document_id);

alter table public.issue_logs
  add column if not exists document_id uuid
    references public.vehicle_documents(id) on delete set null;
create index if not exists issue_logs_document_id_idx
  on public.issue_logs (document_id);

alter table public.vehicle_insurance
  add column if not exists document_id uuid
    references public.vehicle_documents(id) on delete set null;
create index if not exists vehicle_insurance_document_id_idx
  on public.vehicle_insurance (document_id);

alter table public.vehicle_registration
  add column if not exists document_id uuid
    references public.vehicle_documents(id) on delete set null;
create index if not exists vehicle_registration_document_id_idx
  on public.vehicle_registration (document_id);

alter table public.vehicle_inspection
  add column if not exists document_id uuid
    references public.vehicle_documents(id) on delete set null;
create index if not exists vehicle_inspection_document_id_idx
  on public.vehicle_inspection (document_id);

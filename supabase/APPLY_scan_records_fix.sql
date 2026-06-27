-- =============================================================================
-- Vin.ID — One-shot fix: apply the two June-11 "scan records" migrations
-- =============================================================================
-- Fixes the runtime error:
--   column maintenance_logs.document_id does not exist  (SQLSTATE 42703)
--
-- These two migrations were never applied to this Supabase project:
--   1) 20260611120000_vehicle_insurance_registration_inspection.sql
--   2) 20260611130000_records_document_link.sql
--
-- This consolidated script is IDEMPOTENT — safe to run even if part of it was
-- already applied (IF NOT EXISTS / OR REPLACE / DROP POLICY IF EXISTS).
-- Paste the whole thing into the Supabase SQL Editor and Run.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Category record tables: insurance / registration / inspection
-- -----------------------------------------------------------------------------
create table if not exists public.vehicle_insurance (
  id             uuid primary key default gen_random_uuid(),
  owner_user_id  uuid not null references auth.users(id) on delete cascade,
  vehicle_id     uuid not null references public.vehicles(id) on delete cascade,
  insurer_name   text,
  start_date     date,
  end_date       date,
  cost           numeric(12, 2),
  insurance_type text,
  trust_label    text not null default 'user_entered'
                   check (trust_label in (
                     'user_entered', 'document_backed', 'ai_extracted',
                     'mechanic_verified', 'external_source'
                   )),
  source_type    text not null default 'user',
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz
);
create index if not exists vehicle_insurance_owner_user_id_idx on public.vehicle_insurance (owner_user_id);
create index if not exists vehicle_insurance_vehicle_id_idx    on public.vehicle_insurance (vehicle_id);
create or replace trigger vehicle_insurance_set_updated_at
  before update on public.vehicle_insurance
  for each row execute function public.set_updated_at();
alter table public.vehicle_insurance enable row level security;
drop policy if exists "vehicle_insurance_select_own" on public.vehicle_insurance;
drop policy if exists "vehicle_insurance_insert_own" on public.vehicle_insurance;
drop policy if exists "vehicle_insurance_update_own" on public.vehicle_insurance;
drop policy if exists "vehicle_insurance_delete_own" on public.vehicle_insurance;
create policy "vehicle_insurance_select_own" on public.vehicle_insurance
  for select using (owner_user_id = (select auth.uid()));
create policy "vehicle_insurance_insert_own" on public.vehicle_insurance
  for insert with check (owner_user_id = (select auth.uid()));
create policy "vehicle_insurance_update_own" on public.vehicle_insurance
  for update using (owner_user_id = (select auth.uid()))
              with check (owner_user_id = (select auth.uid()));
create policy "vehicle_insurance_delete_own" on public.vehicle_insurance
  for delete using (owner_user_id = (select auth.uid()));

create table if not exists public.vehicle_registration (
  id            uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  vehicle_id    uuid not null references public.vehicles(id) on delete cascade,
  start_date    date,
  end_date      date,
  mileage       integer check (mileage is null or mileage >= 0),
  notes         text,
  trust_label   text not null default 'user_entered'
                  check (trust_label in (
                    'user_entered', 'document_backed', 'ai_extracted',
                    'mechanic_verified', 'external_source'
                  )),
  source_type   text not null default 'user',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz
);
create index if not exists vehicle_registration_owner_user_id_idx on public.vehicle_registration (owner_user_id);
create index if not exists vehicle_registration_vehicle_id_idx    on public.vehicle_registration (vehicle_id);
create or replace trigger vehicle_registration_set_updated_at
  before update on public.vehicle_registration
  for each row execute function public.set_updated_at();
alter table public.vehicle_registration enable row level security;
drop policy if exists "vehicle_registration_select_own" on public.vehicle_registration;
drop policy if exists "vehicle_registration_insert_own" on public.vehicle_registration;
drop policy if exists "vehicle_registration_update_own" on public.vehicle_registration;
drop policy if exists "vehicle_registration_delete_own" on public.vehicle_registration;
create policy "vehicle_registration_select_own" on public.vehicle_registration
  for select using (owner_user_id = (select auth.uid()));
create policy "vehicle_registration_insert_own" on public.vehicle_registration
  for insert with check (owner_user_id = (select auth.uid()));
create policy "vehicle_registration_update_own" on public.vehicle_registration
  for update using (owner_user_id = (select auth.uid()))
              with check (owner_user_id = (select auth.uid()));
create policy "vehicle_registration_delete_own" on public.vehicle_registration
  for delete using (owner_user_id = (select auth.uid()));

create table if not exists public.vehicle_inspection (
  id            uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  vehicle_id    uuid not null references public.vehicles(id) on delete cascade,
  start_date    date,
  end_date      date,
  mileage       integer check (mileage is null or mileage >= 0),
  cost          numeric(12, 2),
  notes         text,
  trust_label   text not null default 'user_entered'
                  check (trust_label in (
                    'user_entered', 'document_backed', 'ai_extracted',
                    'mechanic_verified', 'external_source'
                  )),
  source_type   text not null default 'user',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz
);
create index if not exists vehicle_inspection_owner_user_id_idx on public.vehicle_inspection (owner_user_id);
create index if not exists vehicle_inspection_vehicle_id_idx    on public.vehicle_inspection (vehicle_id);
create or replace trigger vehicle_inspection_set_updated_at
  before update on public.vehicle_inspection
  for each row execute function public.set_updated_at();
alter table public.vehicle_inspection enable row level security;
drop policy if exists "vehicle_inspection_select_own" on public.vehicle_inspection;
drop policy if exists "vehicle_inspection_insert_own" on public.vehicle_inspection;
drop policy if exists "vehicle_inspection_update_own" on public.vehicle_inspection;
drop policy if exists "vehicle_inspection_delete_own" on public.vehicle_inspection;
create policy "vehicle_inspection_select_own" on public.vehicle_inspection
  for select using (owner_user_id = (select auth.uid()));
create policy "vehicle_inspection_insert_own" on public.vehicle_inspection
  for insert with check (owner_user_id = (select auth.uid()));
create policy "vehicle_inspection_update_own" on public.vehicle_inspection
  for update using (owner_user_id = (select auth.uid()))
              with check (owner_user_id = (select auth.uid()));
create policy "vehicle_inspection_delete_own" on public.vehicle_inspection
  for delete using (owner_user_id = (select auth.uid()));

grant select, insert, update, delete
  on public.vehicle_insurance,
     public.vehicle_registration,
     public.vehicle_inspection
  to authenticated;

-- -----------------------------------------------------------------------------
-- 2. Link scan-created records to their saved document (the failing column)
-- -----------------------------------------------------------------------------
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

-- =============================================================================
-- Done. Reload /vehicles — the 42703 error should be gone.
-- =============================================================================

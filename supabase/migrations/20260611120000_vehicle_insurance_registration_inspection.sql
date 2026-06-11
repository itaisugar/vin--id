-- =============================================================================
-- Vin.ID — Document scan categories: insurance / registration / inspection
-- =============================================================================
-- Adds three owner-scoped record tables populated by the "Scan a document" flow
-- (and, later, manual entry). They mirror the existing maintenance_logs
-- conventions exactly:
--   * uuid PK via gen_random_uuid()
--   * owner_user_id + vehicle_id FKs to auth.users / public.vehicles, ON DELETE
--     CASCADE, with owner_user_id denormalized for simple RLS + indexes
--   * date columns for validity ranges, integer mileage (>= 0), numeric(12,2)
--     cost, free-text notes
--   * trust_label with the product 5-value vocabulary (default 'user_entered')
--   * source_type (default 'user'); the scan flow inserts 'document_scan'
--   * created_at / updated_at timestamptz (updated_at kept current by trigger)
--   * soft delete via deleted_at
--   * RLS ENABLED with owner-only select/insert/update/delete. NO public/anon
--     SELECT policy. NO service-role exposure.
--   * indexes on owner_user_id and vehicle_id
-- =============================================================================

-- -----------------------------------------------------------------------------
-- vehicle_insurance
-- -----------------------------------------------------------------------------
create table public.vehicle_insurance (
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

create index vehicle_insurance_owner_user_id_idx on public.vehicle_insurance (owner_user_id);
create index vehicle_insurance_vehicle_id_idx    on public.vehicle_insurance (vehicle_id);

create trigger vehicle_insurance_set_updated_at
  before update on public.vehicle_insurance
  for each row execute function public.set_updated_at();

alter table public.vehicle_insurance enable row level security;

create policy "vehicle_insurance_select_own" on public.vehicle_insurance
  for select using (owner_user_id = (select auth.uid()));
create policy "vehicle_insurance_insert_own" on public.vehicle_insurance
  for insert with check (owner_user_id = (select auth.uid()));
create policy "vehicle_insurance_update_own" on public.vehicle_insurance
  for update using (owner_user_id = (select auth.uid()))
              with check (owner_user_id = (select auth.uid()));
create policy "vehicle_insurance_delete_own" on public.vehicle_insurance
  for delete using (owner_user_id = (select auth.uid()));


-- -----------------------------------------------------------------------------
-- vehicle_registration (vehicle licensing)
-- -----------------------------------------------------------------------------
create table public.vehicle_registration (
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

create index vehicle_registration_owner_user_id_idx on public.vehicle_registration (owner_user_id);
create index vehicle_registration_vehicle_id_idx    on public.vehicle_registration (vehicle_id);

create trigger vehicle_registration_set_updated_at
  before update on public.vehicle_registration
  for each row execute function public.set_updated_at();

alter table public.vehicle_registration enable row level security;

create policy "vehicle_registration_select_own" on public.vehicle_registration
  for select using (owner_user_id = (select auth.uid()));
create policy "vehicle_registration_insert_own" on public.vehicle_registration
  for insert with check (owner_user_id = (select auth.uid()));
create policy "vehicle_registration_update_own" on public.vehicle_registration
  for update using (owner_user_id = (select auth.uid()))
              with check (owner_user_id = (select auth.uid()));
create policy "vehicle_registration_delete_own" on public.vehicle_registration
  for delete using (owner_user_id = (select auth.uid()));


-- -----------------------------------------------------------------------------
-- vehicle_inspection (vehicle test)
-- -----------------------------------------------------------------------------
create table public.vehicle_inspection (
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

create index vehicle_inspection_owner_user_id_idx on public.vehicle_inspection (owner_user_id);
create index vehicle_inspection_vehicle_id_idx    on public.vehicle_inspection (vehicle_id);

create trigger vehicle_inspection_set_updated_at
  before update on public.vehicle_inspection
  for each row execute function public.set_updated_at();

alter table public.vehicle_inspection enable row level security;

create policy "vehicle_inspection_select_own" on public.vehicle_inspection
  for select using (owner_user_id = (select auth.uid()));
create policy "vehicle_inspection_insert_own" on public.vehicle_inspection
  for insert with check (owner_user_id = (select auth.uid()));
create policy "vehicle_inspection_update_own" on public.vehicle_inspection
  for update using (owner_user_id = (select auth.uid()))
              with check (owner_user_id = (select auth.uid()));
create policy "vehicle_inspection_delete_own" on public.vehicle_inspection
  for delete using (owner_user_id = (select auth.uid()));


-- -----------------------------------------------------------------------------
-- Table privileges. The schema's ALTER DEFAULT PRIVILEGES (migration
-- 20260607140000) already covers tables created later by the same role, but we
-- grant explicitly too so access never depends on which role ran this. RLS
-- still restricts each user to their own rows; `anon` is intentionally omitted.
-- -----------------------------------------------------------------------------
grant select, insert, update, delete
  on public.vehicle_insurance,
     public.vehicle_registration,
     public.vehicle_inspection
  to authenticated;

-- =============================================================================
-- End of migration
-- =============================================================================

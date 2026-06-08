-- =============================================================================
-- Vin.ID — Phase 2A: Core database schema + RLS foundation
-- =============================================================================
-- This migration creates the core tables, Row Level Security (RLS) policies,
-- indexes, and helper triggers for Vin.ID.
--
-- Conventions used throughout:
--   * UUID primary keys via gen_random_uuid().
--   * created_at / updated_at timestamptz where relevant (updated_at is kept
--     current by the set_updated_at() trigger).
--   * owner_user_id references auth.users(id) and is denormalized onto child
--     tables so RLS policies and indexes stay simple and consistent.
--   * RLS is ENABLED on every user-sensitive table; default-deny applies, so
--     only the rows a user owns are accessible.
--   * Soft delete via deleted_at on user-facing content tables. Hard deletes
--     are avoided for vehicles (they become archived/sold instead).
--   * No public/anon SELECT policies anywhere. Public passport previews will be
--     served later by a trusted server route using the service role key.
-- =============================================================================

create extension if not exists pgcrypto;

-- -----------------------------------------------------------------------------
-- Helper: keep updated_at current on UPDATE
-- -----------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- Helper: auto-create a profile row when a new auth user signs up
-- -----------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id)
  values (new.id)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();


-- =============================================================================
-- 1. profiles  (1:1 with auth.users; id IS the auth user id)
-- =============================================================================
create table public.profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  full_name     text,
  phone         text,
  avatar_url    text,
  locale        text not null default 'en' check (locale in ('en', 'he')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

alter table public.profiles enable row level security;

create policy "profiles_select_own" on public.profiles
  for select using (id = (select auth.uid()));
create policy "profiles_insert_own" on public.profiles
  for insert with check (id = (select auth.uid()));
create policy "profiles_update_own" on public.profiles
  for update using (id = (select auth.uid())) with check (id = (select auth.uid()));
-- Note: no DELETE policy — profiles are removed via the auth.users cascade.


-- =============================================================================
-- 2. vehicles
-- =============================================================================
create table public.vehicles (
  id              uuid primary key default gen_random_uuid(),
  owner_user_id   uuid not null references auth.users(id) on delete cascade,
  vin             text,
  make            text,
  model           text,
  year            integer check (year is null or (year between 1900 and 2100)),
  trim            text,
  color           text,
  license_plate   text,
  nickname        text,
  current_mileage integer check (current_mileage is null or current_mileage >= 0),
  status          text not null default 'active'
                    check (status in ('active', 'archived', 'sold')),
  archived_at     timestamptz,
  sold_at         timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz
);

create index vehicles_owner_user_id_idx on public.vehicles (owner_user_id);
create index vehicles_status_idx        on public.vehicles (status);

create trigger vehicles_set_updated_at
  before update on public.vehicles
  for each row execute function public.set_updated_at();

alter table public.vehicles enable row level security;

create policy "vehicles_select_own" on public.vehicles
  for select using (owner_user_id = (select auth.uid()));
create policy "vehicles_insert_own" on public.vehicles
  for insert with check (owner_user_id = (select auth.uid()));
create policy "vehicles_update_own" on public.vehicles
  for update using (owner_user_id = (select auth.uid()))
              with check (owner_user_id = (select auth.uid()));
create policy "vehicles_delete_own" on public.vehicles
  for delete using (owner_user_id = (select auth.uid()));


-- =============================================================================
-- 3. maintenance_logs
-- =============================================================================
create table public.maintenance_logs (
  id            uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  vehicle_id    uuid not null references public.vehicles(id) on delete cascade,
  service_type  text,
  description   text,
  performed_at  date,
  mileage       integer check (mileage is null or mileage >= 0),
  cost          numeric(12, 2),
  currency      text not null default 'ILS',
  vendor_name   text,
  trust_label   text not null default 'self_reported'
                  check (trust_label in ('self_reported', 'document_backed', 'shop_verified')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz
);

create index maintenance_logs_owner_user_id_idx on public.maintenance_logs (owner_user_id);
create index maintenance_logs_vehicle_id_idx    on public.maintenance_logs (vehicle_id);

create trigger maintenance_logs_set_updated_at
  before update on public.maintenance_logs
  for each row execute function public.set_updated_at();

alter table public.maintenance_logs enable row level security;

create policy "maintenance_logs_select_own" on public.maintenance_logs
  for select using (owner_user_id = (select auth.uid()));
create policy "maintenance_logs_insert_own" on public.maintenance_logs
  for insert with check (owner_user_id = (select auth.uid()));
create policy "maintenance_logs_update_own" on public.maintenance_logs
  for update using (owner_user_id = (select auth.uid()))
              with check (owner_user_id = (select auth.uid()));
create policy "maintenance_logs_delete_own" on public.maintenance_logs
  for delete using (owner_user_id = (select auth.uid()));


-- =============================================================================
-- 4. issue_logs
-- =============================================================================
create table public.issue_logs (
  id            uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  vehicle_id    uuid not null references public.vehicles(id) on delete cascade,
  title         text not null,
  description   text,
  severity      text not null default 'medium'
                  check (severity in ('low', 'medium', 'high', 'critical')),
  status        text not null default 'open'
                  check (status in ('open', 'monitoring', 'resolved')),
  mileage       integer check (mileage is null or mileage >= 0),
  reported_at   date,
  resolved_at   timestamptz,
  trust_label   text not null default 'self_reported'
                  check (trust_label in ('self_reported', 'document_backed', 'shop_verified')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz
);

create index issue_logs_owner_user_id_idx on public.issue_logs (owner_user_id);
create index issue_logs_vehicle_id_idx    on public.issue_logs (vehicle_id);

create trigger issue_logs_set_updated_at
  before update on public.issue_logs
  for each row execute function public.set_updated_at();

alter table public.issue_logs enable row level security;

create policy "issue_logs_select_own" on public.issue_logs
  for select using (owner_user_id = (select auth.uid()));
create policy "issue_logs_insert_own" on public.issue_logs
  for insert with check (owner_user_id = (select auth.uid()));
create policy "issue_logs_update_own" on public.issue_logs
  for update using (owner_user_id = (select auth.uid()))
              with check (owner_user_id = (select auth.uid()));
create policy "issue_logs_delete_own" on public.issue_logs
  for delete using (owner_user_id = (select auth.uid()));


-- =============================================================================
-- 5. vehicle_documents
-- =============================================================================
-- storage_path references an object in a PRIVATE storage bucket. The bucket is
-- intentionally NOT created in this phase (see supabase/README.md).
create table public.vehicle_documents (
  id            uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  vehicle_id    uuid not null references public.vehicles(id) on delete cascade,
  doc_type      text not null default 'other'
                  check (doc_type in ('invoice', 'registration', 'insurance', 'inspection', 'other')),
  title         text,
  storage_path  text,
  file_name     text,
  mime_type     text,
  file_size     bigint check (file_size is null or file_size >= 0),
  trust_label   text not null default 'self_reported'
                  check (trust_label in ('self_reported', 'document_backed', 'shop_verified')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz
);

create index vehicle_documents_owner_user_id_idx on public.vehicle_documents (owner_user_id);
create index vehicle_documents_vehicle_id_idx    on public.vehicle_documents (vehicle_id);

create trigger vehicle_documents_set_updated_at
  before update on public.vehicle_documents
  for each row execute function public.set_updated_at();

alter table public.vehicle_documents enable row level security;

create policy "vehicle_documents_select_own" on public.vehicle_documents
  for select using (owner_user_id = (select auth.uid()));
create policy "vehicle_documents_insert_own" on public.vehicle_documents
  for insert with check (owner_user_id = (select auth.uid()));
create policy "vehicle_documents_update_own" on public.vehicle_documents
  for update using (owner_user_id = (select auth.uid()))
              with check (owner_user_id = (select auth.uid()));
create policy "vehicle_documents_delete_own" on public.vehicle_documents
  for delete using (owner_user_id = (select auth.uid()));


-- =============================================================================
-- 6. document_extractions  (AI/OCR output for a document — schema only)
-- =============================================================================
create table public.document_extractions (
  id             uuid primary key default gen_random_uuid(),
  owner_user_id  uuid not null references auth.users(id) on delete cascade,
  document_id    uuid not null references public.vehicle_documents(id) on delete cascade,
  vehicle_id     uuid references public.vehicles(id) on delete cascade,
  status         text not null default 'pending'
                   check (status in ('pending', 'processing', 'completed', 'failed')),
  engine         text not null default 'mock',
  extracted_data jsonb not null default '{}'::jsonb,
  confidence     numeric(5, 2) check (confidence is null or (confidence between 0 and 100)),
  raw_text       text,
  error          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index document_extractions_owner_user_id_idx on public.document_extractions (owner_user_id);
create index document_extractions_document_id_idx   on public.document_extractions (document_id);
create index document_extractions_vehicle_id_idx    on public.document_extractions (vehicle_id);

create trigger document_extractions_set_updated_at
  before update on public.document_extractions
  for each row execute function public.set_updated_at();

alter table public.document_extractions enable row level security;

create policy "document_extractions_select_own" on public.document_extractions
  for select using (owner_user_id = (select auth.uid()));
create policy "document_extractions_insert_own" on public.document_extractions
  for insert with check (owner_user_id = (select auth.uid()));
create policy "document_extractions_update_own" on public.document_extractions
  for update using (owner_user_id = (select auth.uid()))
              with check (owner_user_id = (select auth.uid()));
create policy "document_extractions_delete_own" on public.document_extractions
  for delete using (owner_user_id = (select auth.uid()));


-- =============================================================================
-- 7. reminders
-- =============================================================================
create table public.reminders (
  id            uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  vehicle_id    uuid not null references public.vehicles(id) on delete cascade,
  title         text not null,
  description   text,
  reminder_type text not null default 'custom'
                  check (reminder_type in ('service', 'inspection', 'insurance', 'registration', 'custom')),
  due_date      date,
  due_mileage   integer check (due_mileage is null or due_mileage >= 0),
  status        text not null default 'pending'
                  check (status in ('pending', 'completed', 'dismissed')),
  completed_at  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz
);

create index reminders_owner_user_id_idx on public.reminders (owner_user_id);
create index reminders_vehicle_id_idx    on public.reminders (vehicle_id);
create index reminders_due_date_idx      on public.reminders (due_date);

create trigger reminders_set_updated_at
  before update on public.reminders
  for each row execute function public.set_updated_at();

alter table public.reminders enable row level security;

create policy "reminders_select_own" on public.reminders
  for select using (owner_user_id = (select auth.uid()));
create policy "reminders_insert_own" on public.reminders
  for insert with check (owner_user_id = (select auth.uid()));
create policy "reminders_update_own" on public.reminders
  for update using (owner_user_id = (select auth.uid()))
              with check (owner_user_id = (select auth.uid()));
create policy "reminders_delete_own" on public.reminders
  for delete using (owner_user_id = (select auth.uid()));


-- =============================================================================
-- 8. diagnosis_sessions  (AI-assisted diagnosis — schema only)
-- =============================================================================
create table public.diagnosis_sessions (
  id            uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  vehicle_id    uuid references public.vehicles(id) on delete cascade,
  title         text,
  status        text not null default 'active'
                  check (status in ('active', 'closed')),
  mode          text not null default 'mock',
  summary       text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz
);

create index diagnosis_sessions_owner_user_id_idx on public.diagnosis_sessions (owner_user_id);
create index diagnosis_sessions_vehicle_id_idx    on public.diagnosis_sessions (vehicle_id);

create trigger diagnosis_sessions_set_updated_at
  before update on public.diagnosis_sessions
  for each row execute function public.set_updated_at();

alter table public.diagnosis_sessions enable row level security;

create policy "diagnosis_sessions_select_own" on public.diagnosis_sessions
  for select using (owner_user_id = (select auth.uid()));
create policy "diagnosis_sessions_insert_own" on public.diagnosis_sessions
  for insert with check (owner_user_id = (select auth.uid()));
create policy "diagnosis_sessions_update_own" on public.diagnosis_sessions
  for update using (owner_user_id = (select auth.uid()))
              with check (owner_user_id = (select auth.uid()));
create policy "diagnosis_sessions_delete_own" on public.diagnosis_sessions
  for delete using (owner_user_id = (select auth.uid()));


-- =============================================================================
-- 9. diagnosis_messages  (append-only chat messages — schema only)
-- =============================================================================
create table public.diagnosis_messages (
  id            uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  session_id    uuid not null references public.diagnosis_sessions(id) on delete cascade,
  role          text not null check (role in ('user', 'assistant', 'system')),
  content       text not null,
  metadata      jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now()
);

create index diagnosis_messages_owner_user_id_idx on public.diagnosis_messages (owner_user_id);
create index diagnosis_messages_session_id_idx    on public.diagnosis_messages (session_id);

alter table public.diagnosis_messages enable row level security;

create policy "diagnosis_messages_select_own" on public.diagnosis_messages
  for select using (owner_user_id = (select auth.uid()));
create policy "diagnosis_messages_insert_own" on public.diagnosis_messages
  for insert with check (owner_user_id = (select auth.uid()));
create policy "diagnosis_messages_delete_own" on public.diagnosis_messages
  for delete using (owner_user_id = (select auth.uid()));
-- Note: no UPDATE policy — diagnosis messages are immutable once written.


-- =============================================================================
-- 10. vehicle_passports  (frozen, tamper-evident snapshot — schema only)
-- =============================================================================
-- snapshot       : frozen copy of the vehicle history at issuance time.
-- snapshot_hash  : SHA-256 (hex) over the canonical snapshot for tamper checks.
-- public_id      : opaque id used by the FUTURE public preview server route.
--                  IMPORTANT: there is NO public/anon RLS policy here; the
--                  preview will be served by a trusted server route only.
create table public.vehicle_passports (
  id                      uuid primary key default gen_random_uuid(),
  owner_user_id           uuid not null references auth.users(id) on delete cascade,
  vehicle_id              uuid not null references public.vehicles(id) on delete cascade,
  public_id               uuid not null unique default gen_random_uuid(),
  status                  text not null default 'draft'
                            check (status in ('draft', 'active', 'revoked', 'expired', 'accepted')),
  version                 integer not null default 1,
  snapshot                jsonb not null default '{}'::jsonb,
  snapshot_hash           text,
  record_confidence_score integer
                            check (record_confidence_score is null
                                   or (record_confidence_score between 0 and 100)),
  issued_at               timestamptz,
  expires_at              timestamptz,
  revoked_at              timestamptz,
  accepted_at             timestamptz,
  accepted_by_user_id     uuid references auth.users(id) on delete set null,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  deleted_at              timestamptz
);

create index vehicle_passports_owner_user_id_idx on public.vehicle_passports (owner_user_id);
create index vehicle_passports_vehicle_id_idx    on public.vehicle_passports (vehicle_id);
create index vehicle_passports_status_idx        on public.vehicle_passports (status);

create trigger vehicle_passports_set_updated_at
  before update on public.vehicle_passports
  for each row execute function public.set_updated_at();

alter table public.vehicle_passports enable row level security;

-- Owner-only access. Deliberately NO public/anon SELECT policy.
create policy "vehicle_passports_select_own" on public.vehicle_passports
  for select using (owner_user_id = (select auth.uid()));
create policy "vehicle_passports_insert_own" on public.vehicle_passports
  for insert with check (owner_user_id = (select auth.uid()));
create policy "vehicle_passports_update_own" on public.vehicle_passports
  for update using (owner_user_id = (select auth.uid()))
              with check (owner_user_id = (select auth.uid()));
create policy "vehicle_passports_delete_own" on public.vehicle_passports
  for delete using (owner_user_id = (select auth.uid()));


-- =============================================================================
-- 11. transfer_tokens  (shareable transfer links — store HASH only)
-- =============================================================================
-- SECURITY: only token_hash is stored. The raw token is shown to the issuer
-- once and never persisted. Lookups by token happen server-side by hashing the
-- presented token and comparing to token_hash.
create table public.transfer_tokens (
  id              uuid primary key default gen_random_uuid(),
  owner_user_id   uuid not null references auth.users(id) on delete cascade,
  passport_id     uuid not null references public.vehicle_passports(id) on delete cascade,
  vehicle_id      uuid references public.vehicles(id) on delete cascade,
  token_hash      text not null unique,
  status          text not null default 'active'
                    check (status in ('active', 'used', 'revoked', 'expired')),
  expires_at      timestamptz,
  used_at         timestamptz,
  used_by_user_id uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index transfer_tokens_owner_user_id_idx on public.transfer_tokens (owner_user_id);
create index transfer_tokens_passport_id_idx   on public.transfer_tokens (passport_id);
create index transfer_tokens_vehicle_id_idx    on public.transfer_tokens (vehicle_id);

create trigger transfer_tokens_set_updated_at
  before update on public.transfer_tokens
  for each row execute function public.set_updated_at();

alter table public.transfer_tokens enable row level security;

-- Only the issuer (owner) can manage tokens. Redemption by a buyer happens via
-- a trusted server route (service role), not through a public RLS policy.
create policy "transfer_tokens_select_own" on public.transfer_tokens
  for select using (owner_user_id = (select auth.uid()));
create policy "transfer_tokens_insert_own" on public.transfer_tokens
  for insert with check (owner_user_id = (select auth.uid()));
create policy "transfer_tokens_update_own" on public.transfer_tokens
  for update using (owner_user_id = (select auth.uid()))
              with check (owner_user_id = (select auth.uid()));
create policy "transfer_tokens_delete_own" on public.transfer_tokens
  for delete using (owner_user_id = (select auth.uid()));


-- =============================================================================
-- 12. ownership_transfers  (seller -> buyer; both parties can view)
-- =============================================================================
-- from_user_id   : seller (initiator).
-- to_user_id     : buyer (set when the transfer is claimed/accepted).
-- new_vehicle_id : the COPIED vehicle created for the buyer (history is copied;
--                  the seller's vehicle is archived/sold, never deleted).
create table public.ownership_transfers (
  id                uuid primary key default gen_random_uuid(),
  from_user_id      uuid not null references auth.users(id) on delete cascade,
  to_user_id        uuid references auth.users(id) on delete set null,
  vehicle_id        uuid not null references public.vehicles(id) on delete cascade,
  passport_id       uuid references public.vehicle_passports(id) on delete set null,
  transfer_token_id uuid references public.transfer_tokens(id) on delete set null,
  new_vehicle_id    uuid references public.vehicles(id) on delete set null,
  status            text not null default 'pending'
                      check (status in ('pending', 'accepted', 'cancelled', 'completed')),
  initiated_at      timestamptz not null default now(),
  accepted_at       timestamptz,
  cancelled_at      timestamptz,
  completed_at      timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index ownership_transfers_from_user_id_idx on public.ownership_transfers (from_user_id);
create index ownership_transfers_to_user_id_idx   on public.ownership_transfers (to_user_id);
create index ownership_transfers_vehicle_id_idx   on public.ownership_transfers (vehicle_id);

create trigger ownership_transfers_set_updated_at
  before update on public.ownership_transfers
  for each row execute function public.set_updated_at();

alter table public.ownership_transfers enable row level security;

-- Either party (seller or buyer) may read the transfer.
create policy "ownership_transfers_select_party" on public.ownership_transfers
  for select using (
    from_user_id = (select auth.uid()) or to_user_id = (select auth.uid())
  );
-- Only the seller can create a transfer for their own vehicle.
create policy "ownership_transfers_insert_seller" on public.ownership_transfers
  for insert with check (from_user_id = (select auth.uid()));
-- Either party may update (e.g. seller cancels, buyer accepts).
create policy "ownership_transfers_update_party" on public.ownership_transfers
  for update using (
    from_user_id = (select auth.uid()) or to_user_id = (select auth.uid())
  ) with check (
    from_user_id = (select auth.uid()) or to_user_id = (select auth.uid())
  );
-- Only the seller may delete a transfer they initiated.
create policy "ownership_transfers_delete_seller" on public.ownership_transfers
  for delete using (from_user_id = (select auth.uid()));


-- =============================================================================
-- 13. audit_logs  (append-only, immutable)
-- =============================================================================
create table public.audit_logs (
  id            uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  vehicle_id    uuid references public.vehicles(id) on delete set null,
  entity_type   text not null,
  entity_id     uuid,
  action        text not null,
  metadata      jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now()
);

create index audit_logs_owner_user_id_idx on public.audit_logs (owner_user_id);
create index audit_logs_vehicle_id_idx    on public.audit_logs (vehicle_id);
create index audit_logs_entity_idx        on public.audit_logs (entity_type, entity_id);

alter table public.audit_logs enable row level security;

-- Users may read and append their own audit entries. No UPDATE/DELETE policies
-- keep the trail immutable from the client (server/service role can write more).
create policy "audit_logs_select_own" on public.audit_logs
  for select using (owner_user_id = (select auth.uid()));
create policy "audit_logs_insert_own" on public.audit_logs
  for insert with check (owner_user_id = (select auth.uid()));

-- =============================================================================
-- End of migration
-- =============================================================================

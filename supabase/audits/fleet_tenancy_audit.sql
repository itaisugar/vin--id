-- =============================================================================
-- Vin.ID Fleet Lite — multi-tenancy audit
-- =============================================================================
-- Run this in the Supabase SQL Editor AFTER applying:
--   20260722120000_fleet_organizations.sql
--   20260722130000_fleet_vehicle_fields.sql
--
-- Every query below is a DETECTION query: each one must return ZERO ROWS.
-- A non-empty result means the tenancy conversion is incomplete or unsafe.
-- Nothing here mutates data.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. Every profile belongs to an organization and has a valid role.
--    Expected: 0 rows.
-- -----------------------------------------------------------------------------
select 'profile without organization' as problem, p.id
from public.profiles p
where p.organization_id is null

union all

select 'profile with invalid role', p.id
from public.profiles p
where p.role not in ('owner', 'admin', 'fleet_manager', 'viewer');


-- -----------------------------------------------------------------------------
-- 2. No fleet row is left without an organization.
--    Expected: 0 rows. (If any table appears here, the migration left its
--    organization_id NULLABLE on purpose and raised a warning — investigate.)
-- -----------------------------------------------------------------------------
do $$
declare
  t text;
  n bigint;
  fleet_tables text[] := array[
    'vehicles', 'maintenance_logs', 'issue_logs', 'vehicle_documents',
    'document_extractions', 'reminders', 'vehicle_passports',
    'transfer_tokens', 'vehicle_insurance', 'vehicle_registration',
    'vehicle_inspection'
  ];
begin
  foreach t in array fleet_tables loop
    if exists (
      select 1 from information_schema.tables
      where table_schema = 'public' and table_name = t
    ) then
      execute format('select count(*) from public.%I where organization_id is null', t) into n;
      if n > 0 then
        raise warning 'FAIL %: % row(s) with NULL organization_id', t, n;
      else
        raise notice 'ok %', t;
      end if;
    end if;
  end loop;
end;
$$;


-- -----------------------------------------------------------------------------
-- 3. A row's organization must match its owner's organization.
--    Catches any insert path that bypassed the auto-fill trigger.
--    Expected: 0 rows.
-- -----------------------------------------------------------------------------
select 'vehicles' as tbl, v.id
from public.vehicles v
join public.profiles p on p.id = v.owner_user_id
where v.organization_id is distinct from p.organization_id

union all
select 'maintenance_logs', m.id
from public.maintenance_logs m
join public.profiles p on p.id = m.owner_user_id
where m.organization_id is distinct from p.organization_id

union all
select 'issue_logs', i.id
from public.issue_logs i
join public.profiles p on p.id = i.owner_user_id
where i.organization_id is distinct from p.organization_id

union all
select 'vehicle_documents', d.id
from public.vehicle_documents d
join public.profiles p on p.id = d.owner_user_id
where d.organization_id is distinct from p.organization_id

union all
select 'reminders', r.id
from public.reminders r
join public.profiles p on p.id = r.owner_user_id
where r.organization_id is distinct from p.organization_id

union all
select 'vehicle_passports', vp.id
from public.vehicle_passports vp
join public.profiles p on p.id = vp.owner_user_id
where vp.organization_id is distinct from p.organization_id;


-- -----------------------------------------------------------------------------
-- 4. A child row must live in the same organization as its vehicle.
--    This is the real cross-tenant leak test.
--    Expected: 0 rows.
-- -----------------------------------------------------------------------------
select 'maintenance_logs' as tbl, m.id
from public.maintenance_logs m
join public.vehicles v on v.id = m.vehicle_id
where m.organization_id is distinct from v.organization_id

union all
select 'issue_logs', i.id
from public.issue_logs i
join public.vehicles v on v.id = i.vehicle_id
where i.organization_id is distinct from v.organization_id

union all
select 'vehicle_documents', d.id
from public.vehicle_documents d
join public.vehicles v on v.id = d.vehicle_id
where d.organization_id is distinct from v.organization_id

union all
select 'reminders', r.id
from public.reminders r
join public.vehicles v on v.id = r.vehicle_id
where r.organization_id is distinct from v.organization_id

union all
select 'vehicle_passports', vp.id
from public.vehicle_passports vp
join public.vehicles v on v.id = vp.vehicle_id
where vp.organization_id is distinct from v.organization_id;


-- -----------------------------------------------------------------------------
-- 5. No surviving owner-scoped policy on a converted table.
--    RLS policies are permissive (OR-combined), so a leftover
--    `owner_user_id = auth.uid()` policy would re-open cross-org access and
--    defeat the viewer read-only role.
--    Expected: 0 rows.
-- -----------------------------------------------------------------------------
select tablename, policyname, qual::text as using_clause
from pg_policies
where schemaname = 'public'
  and tablename in (
    'vehicles', 'maintenance_logs', 'issue_logs', 'vehicle_documents',
    'document_extractions', 'reminders', 'vehicle_passports',
    'transfer_tokens', 'vehicle_insurance', 'vehicle_registration',
    'vehicle_inspection'
  )
  and coalesce(qual::text, '') || coalesce(with_check::text, '') not like '%current_org_id%';


-- -----------------------------------------------------------------------------
-- 6. RLS is still ENABLED on every converted table.
--    Expected: 0 rows.
-- -----------------------------------------------------------------------------
select c.relname as table_without_rls
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind = 'r'
  and c.relrowsecurity = false
  and c.relname in (
    'organizations', 'vehicles', 'maintenance_logs', 'issue_logs',
    'vehicle_documents', 'document_extractions', 'reminders',
    'vehicle_passports', 'transfer_tokens', 'vehicle_insurance',
    'vehicle_registration', 'vehicle_inspection'
  );


-- -----------------------------------------------------------------------------
-- 7. `anon` must have NO table privileges anywhere in public.
--    Public passport access goes exclusively through SECURITY DEFINER RPCs.
--    Expected: 0 rows.
-- -----------------------------------------------------------------------------
select table_name, privilege_type
from information_schema.role_table_grants
where table_schema = 'public'
  and grantee = 'anon';


-- -----------------------------------------------------------------------------
-- 8. The auto-fill trigger exists on every converted table.
--    Expected: 0 rows (i.e. no table missing its trigger).
-- -----------------------------------------------------------------------------
with expected(tbl) as (
  select unnest(array[
    'vehicles', 'maintenance_logs', 'issue_logs', 'vehicle_documents',
    'document_extractions', 'reminders', 'vehicle_passports',
    'transfer_tokens', 'vehicle_insurance', 'vehicle_registration',
    'vehicle_inspection'
  ])
)
select e.tbl as table_missing_org_trigger
from expected e
where exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = e.tbl
  )
  and not exists (
    select 1
    from pg_trigger tg
    join pg_class c on c.oid = tg.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = e.tbl
      and tg.tgname = e.tbl || '_set_organization_id'
      and not tg.tgisinternal
  );

-- =============================================================================
-- End of audit
-- =============================================================================

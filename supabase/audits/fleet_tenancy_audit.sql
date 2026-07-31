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
-- 7. `anon` must have no POLICY PATH to any org-scoped row.
--
--    NOTE (corrected 2026-07-24 after runtime validation): the earlier version
--    of this query asserted `anon` holds no table GRANTs. That premise is wrong
--    for Supabase — every Supabase project (local and hosted) grants table
--    privileges to `anon`/`authenticated` by default. A GRANT does NOT bypass
--    RLS: with RLS enabled and every policy gated on `current_org_id()` (which
--    is NULL for an anonymous request, since auth.uid() is NULL), anon matches
--    no rows. This was verified at runtime: an anon client got 0 rows on SELECT
--    and was rejected on INSERT for every org-scoped table.
--
--    The meaningful, statically-checkable invariant is therefore: no permissive
--    policy on an org-scoped table is applicable to `anon`/`public` WITHOUT the
--    org predicate (an unguarded policy would let anon through despite RLS).
--    Query 5 already flags any policy missing `current_org_id`; this query
--    additionally flags a permissive policy that is applicable to anon and is
--    unqualified (USING true / no qual). Expected: 0 rows.
-- -----------------------------------------------------------------------------
select tablename, policyname, cmd, roles::text
from pg_policies
where schemaname = 'public'
  and tablename in (
    'vehicles', 'maintenance_logs', 'issue_logs', 'vehicle_documents',
    'document_extractions', 'reminders', 'vehicle_passports',
    'transfer_tokens', 'vehicle_insurance', 'vehicle_registration',
    'vehicle_inspection'
  )
  and permissive = 'PERMISSIVE'
  -- applicable to anonymous requests (public role includes anon, or anon named)
  and (roles::text[] && array['public', 'anon'])
  -- ...but with no organization predicate guarding it
  and coalesce(qual::text, '') not like '%current_org_id%'
  and coalesce(with_check::text, '') not like '%current_org_id%';


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

-- -----------------------------------------------------------------------------
-- 9. Active-workspace pointer integrity.
--    Every profiles.active_organization_id must name an organization the user
--    still belongs to. current_org_id() ignores a dangling pointer on read, but
--    a lingering one is stale state — after atomic member removal
--    (20260731120000) the repair trigger keeps this at zero.
--    Expected: 0 rows.
-- -----------------------------------------------------------------------------
select p.id as profile_with_invalid_active_pointer,
       p.active_organization_id
from public.profiles p
where p.active_organization_id is not null
  and not exists (
    select 1 from public.organization_members m
    where m.user_id = p.id
      and m.organization_id = p.active_organization_id
  );

-- -----------------------------------------------------------------------------
-- 10. Member-removal grant posture (migration 20260731120000).
--     remove_organization_member(uuid): authenticated only, anon denied.
--     repair_active_workspace_after_member_removal(): direct EXECUTE denied to
--     public, anon AND authenticated — it runs only as a trigger.
--     Expected: 0 rows (every listed expectation holds).
-- -----------------------------------------------------------------------------
select problem from (
  select 'rpc: authenticated cannot execute' as problem
   where not has_function_privilege('authenticated', 'public.remove_organization_member(uuid)', 'execute')
  union all
  select 'rpc: anon CAN execute'
   where has_function_privilege('anon', 'public.remove_organization_member(uuid)', 'execute')
  union all
  select 'trigger fn: public CAN execute'
   where has_function_privilege('public', 'public.repair_active_workspace_after_member_removal()', 'execute')
  union all
  select 'trigger fn: anon CAN execute'
   where has_function_privilege('anon', 'public.repair_active_workspace_after_member_removal()', 'execute')
  union all
  select 'trigger fn: authenticated CAN execute'
   where has_function_privilege('authenticated', 'public.repair_active_workspace_after_member_removal()', 'execute')
) g;

-- =============================================================================
-- End of audit
-- =============================================================================

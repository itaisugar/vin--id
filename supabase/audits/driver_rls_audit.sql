-- =============================================================================
-- Vin.ID Fleet Lite — driver role RLS coverage audit
-- =============================================================================
-- Run AFTER applying
--   20260725210000_driver_role_and_assignments.sql
--   20260725220000_driver_rls.sql
--
-- Every query below is a DETECTION query: each must return ZERO ROWS. Nothing
-- here mutates data.
--
-- WHY THIS AUDIT EXISTS. The Fleet conversion generated one identical policy,
--   using (organization_id = public.current_org_id())
-- for every org-scoped table. That is correct for owner/admin/fleet_manager/
-- viewer and catastrophic for `driver`. A first pass at the driver migrations
-- made five tables driver-aware and left six on the bare organization-wide rule
-- — a mistake no test caught, because no test knew the full table list. Check 1
-- below derives that list from the CATALOG rather than from a hand-written
-- array, so a future org-scoped table is flagged the day it is created and
-- before anyone remembers to think about drivers.
--
-- Checks inspect EFFECTIVE POLICY EXPRESSIONS (pg_policies.qual), never policy
-- names. A policy called "…_driver_safe" that reads `organization_id =
-- current_org_id()` is still flagged.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. THE CORE INVARIANT.
--    Every permissive SELECT policy on an org-scoped table must be driver-aware:
--    it must either subtract drivers outright, scope them to their assignment,
--    scope the row to the caller themselves, or be gated to a manager role.
--    A policy resting on current_org_id() alone grants organization membership
--    = organization-wide read, which is precisely what `driver` must never get.
--
--    Policies are PERMISSIVE and therefore OR-combine, so this is evaluated per
--    policy: one unsafe policy re-opens the table no matter how many safe ones
--    sit beside it.
--    Expected: 0 rows.
-- -----------------------------------------------------------------------------
with org_tables as (
  select c.oid, c.relname
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind = 'r'
    and exists (
      select 1 from pg_attribute a
      where a.attrelid = c.oid
        and a.attname = 'organization_id'
        and a.attnum > 0
        and not a.attisdropped
    )
)
select t.relname     as table_name,
       p.policyname,
       p.permissive,
       p.roles::text as applies_to,
       p.qual        as effective_expression,
       'SELECT policy grants org-wide access with no driver-aware predicate' as defect
from org_tables t
join pg_policies p
  on p.schemaname = 'public' and p.tablename = t.relname
where p.cmd = 'SELECT'
  and p.permissive = 'PERMISSIVE'
  and coalesce(p.qual, '') not like '%is_org_driver()%'
  and coalesce(p.qual, '') not like '%can_access_vehicle(%'
  and coalesce(p.qual, '') not like '%current_driver_vehicle_id()%'
  and coalesce(p.qual, '') not like '%can_manage_driver_assignments()%'
  and coalesce(p.qual, '') not like '%is_org_admin()%'
  -- self-scoped rows (a caller reading only their own record) are inherently safe
  and coalesce(p.qual, '') not like '%auth.uid()%';


-- -----------------------------------------------------------------------------
-- 2. Write paths must never admit a driver.
--    Every INSERT/UPDATE/DELETE policy on an org-scoped table must be gated on a
--    role predicate that excludes `driver`. is_org_writer() is owner/admin/
--    fleet_manager; is_org_admin() is owner/admin; can_manage_driver_assignments()
--    is owner/admin/fleet_manager. A write policy resting on current_org_id()
--    alone would let a driver write.
--    Expected: 0 rows.
-- -----------------------------------------------------------------------------
with org_tables as (
  select c.relname
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r'
    and exists (
      select 1 from pg_attribute a
      where a.attrelid = c.oid and a.attname = 'organization_id'
        and a.attnum > 0 and not a.attisdropped
    )
)
select t.relname as table_name,
       p.policyname,
       p.cmd,
       coalesce(p.qual, p.with_check) as effective_expression,
       'write policy has no role gate excluding driver' as defect
from org_tables t
join pg_policies p
  on p.schemaname = 'public' and p.tablename = t.relname
where p.cmd in ('INSERT', 'UPDATE', 'DELETE')
  and p.permissive = 'PERMISSIVE'
  and (coalesce(p.qual, '') || coalesce(p.with_check, '')) not like '%is_org_writer()%'
  and (coalesce(p.qual, '') || coalesce(p.with_check, '')) not like '%is_org_admin()%'
  and (coalesce(p.qual, '') || coalesce(p.with_check, '')) not like '%can_manage_driver_assignments()%'
  and (coalesce(p.qual, '') || coalesce(p.with_check, '')) not like '%auth.uid()%';


-- -----------------------------------------------------------------------------
-- 3. Cost-bearing and secret-bearing tables must deny drivers OUTRIGHT.
--    Assignment-scoping is not sufficient here: these tables carry money,
--    Storage paths or passport secrets in columns RLS cannot filter, so the
--    only acceptable driver predicate is a flat `not is_org_driver()`.
--    Expected: 0 rows.
-- -----------------------------------------------------------------------------
with sensitive as (
  select c.relname,
         string_agg(a.attname, ', ' order by a.attname) as sensitive_columns
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
  where n.nspname = 'public'
    and c.relkind = 'r'
    and a.attname in (
      'cost', 'currency', 'amount', 'vendor', 'vendor_name',
      'storage_path', 'token_hash', 'snapshot', 'snapshot_hash',
      'server_signature', 'raw_text', 'extracted_data', 'confirmed_data'
    )
    and exists (
      select 1 from pg_attribute a2
      where a2.attrelid = c.oid and a2.attname = 'organization_id'
        and a2.attnum > 0 and not a2.attisdropped
    )
  group by c.relname
)
select s.relname as table_name,
       s.sensitive_columns,
       p.policyname,
       p.qual as effective_expression,
       'sensitive-column table does not flatly deny drivers' as defect
from sensitive s
join pg_policies p
  on p.schemaname = 'public' and p.tablename = s.relname
where p.cmd = 'SELECT'
  and p.permissive = 'PERMISSIVE'
  and coalesce(p.qual, '') not like '%not is_org_driver()%'
  and coalesce(p.qual, '') not like '%NOT is_org_driver()%'
  -- A manager-role gate is STRICTLY STRONGER than `not is_org_driver()`:
  -- is_org_admin() is owner/admin and can_manage_driver_assignments() is
  -- owner/admin/fleet_manager, so both already exclude `driver` by
  -- construction. organization_invitations (token_hash) is admin-gated and
  -- reaches this check legitimately. Accepting them is not a relaxation —
  -- swapping either for `not is_org_driver()` would WIDEN access.
  and coalesce(p.qual, '') not like '%is_org_admin()%'
  and coalesce(p.qual, '') not like '%can_manage_driver_assignments()%';


-- -----------------------------------------------------------------------------
-- 4. The driver-facing RPCs must not return sensitive columns.
--    Inspects each function BODY, so adding `l.cost` to a get_driver_* function
--    is caught here even if the return type is later widened.
--    Expected: 0 rows.
-- -----------------------------------------------------------------------------
select p.proname as function_name,
       'driver-facing function references a sensitive column' as defect
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname like 'get_driver%'
  and p.proname <> 'get_driver_document_path'  -- server-side signed-URL resolver, by design
  and (
       p.prosrc ~* '\mcost\M'
    or p.prosrc ~* '\mcurrency\M'
    or p.prosrc ~* '\mvendor'
    or p.prosrc ~* '\mamount\M'
    or p.prosrc ~* '\mstorage_path\M'
    or p.prosrc ~* '\mtoken_hash\M'
    or p.prosrc ~* '\msnapshot\M'
    or p.prosrc ~* '\mraw_text\M'
    or p.prosrc ~* '\mowner_user_id\M'
  );


-- -----------------------------------------------------------------------------
-- 5. Driver DATA RPCs must not be executable by anon or PUBLIC.
--
--    POLICY HELPERS are excluded, and must be: is_org_driver,
--    current_driver_vehicle_id, can_access_vehicle and
--    can_manage_driver_assignments all appear inside policy expressions on
--    tables that `anon` holds a table grant for. Postgres checks EXECUTE when
--    the policy is planned, so revoking the grant does not deny the anonymous
--    caller — it makes the query RAISE. Verified directly:
--
--      revoke execute on function public.can_manage_driver_assignments() from anon;
--      set local role anon; select count(*) from public.driver_assignments;
--      -- ERROR: permission denied for function can_manage_driver_assignments
--
--    The grant is safe because every one of these helpers is driven by
--    auth.uid(), which is NULL for anon — check 5b asserts exactly that. The
--    pre-existing org helpers (current_org_id, is_org_writer, is_org_admin)
--    carry the same anon grant for the same structural reason.
--
--    Functions that RETURN DATA have no such excuse and must be
--    authenticated-only.
--    Expected: 0 rows.
-- -----------------------------------------------------------------------------
select p.proname as function_name,
       r.rolname as granted_to,
       'driver/assignment RPC is reachable anonymously' as defect
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
join pg_roles r on r.oid = acl.grantee
where n.nspname = 'public'
  and acl.privilege_type = 'EXECUTE'
  and r.rolname in ('anon', 'public')
  and (
    p.proname like 'get_driver%'
    or p.proname in (
      'get_my_driver_vehicle', 'assign_driver', 'unassign_driver',
      'list_eligible_drivers', 'get_vehicle_assignment_history'
    )
  );


-- -----------------------------------------------------------------------------
-- 5b. The policy helpers that anon CAN execute must be inert for anon.
--     This is what makes check 5's exclusion list safe rather than a loophole:
--     with no auth.uid(), every helper must report "not a driver, no org, no
--     vehicle, no rights". Run as anon.
--     Expected: 0 rows.
-- -----------------------------------------------------------------------------
begin;
set local role anon;
select * from (
  select 'is_org_driver'                 as helper, public.is_org_driver()::text                 as value_for_anon
  union all select 'can_manage_driver_assignments', public.can_manage_driver_assignments()::text
  union all select 'is_org_writer',                 public.is_org_writer()::text
  union all select 'is_org_admin',                  public.is_org_admin()::text
  union all select 'current_org_id',                coalesce(public.current_org_id()::text, 'null')
  union all select 'current_driver_vehicle_id',     coalesce(public.current_driver_vehicle_id()::text, 'null')
  union all select 'can_access_vehicle(random)',    public.can_access_vehicle(gen_random_uuid())::text
) h
where h.value_for_anon not in ('false', 'null');
rollback;


-- -----------------------------------------------------------------------------
-- 6. Every driver helper must be SECURITY DEFINER with a pinned search_path.
--    An unpinned search_path on a SECURITY DEFINER function is a privilege
--    escalation vector: the caller can shadow `public` and have the function
--    resolve their own tables as the owner.
--    Expected: 0 rows.
-- -----------------------------------------------------------------------------
with expected(fn) as (
  select unnest(array[
    'is_org_driver', 'current_driver_vehicle_id', 'can_access_vehicle',
    'can_manage_driver_assignments', 'get_my_driver_vehicle',
    'get_driver_maintenance_history', 'get_driver_documents',
    'get_driver_document_path', 'get_driver_reminders',
    'list_eligible_drivers', 'get_vehicle_assignment_history',
    'assign_driver', 'unassign_driver', 'enforce_assignment_member_is_driver'
  ])
)
select e.fn as function_name,
       'missing, not SECURITY DEFINER, or search_path not pinned' as defect
from expected e
where not exists (
  select 1
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = e.fn
    and p.prosecdef = true
    and coalesce(array_to_string(p.proconfig, ','), '') like '%search_path=%'
);


-- -----------------------------------------------------------------------------
-- 7. RLS must be enabled on every org-scoped table.
--    Expected: 0 rows.
-- -----------------------------------------------------------------------------
select c.relname as table_name,
       'row level security is not enabled' as defect
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind = 'r'
  and not c.relrowsecurity
  and exists (
    select 1 from pg_attribute a
    where a.attrelid = c.oid and a.attname = 'organization_id'
      and a.attnum > 0 and not a.attisdropped
  );


-- -----------------------------------------------------------------------------
-- 8. Data integrity: no ACTIVE assignment may point at a non-driver, a dead
--    membership, a cross-organization vehicle, or a deleted vehicle.
--    Expected: 0 rows.
-- -----------------------------------------------------------------------------
select a.id as assignment_id,
       case
         when a.member_id is null                       then 'active assignment has no membership'
         when m.id is null                              then 'membership row is gone'
         when m.role <> 'driver'                        then 'assigned member is not a driver'
         when m.user_id <> a.driver_user_id             then 'driver_user_id does not match membership'
         when v.id is null                              then 'vehicle is missing'
         when v.organization_id <> a.organization_id    then 'vehicle belongs to another organization'
         when v.deleted_at is not null                  then 'vehicle is soft-deleted'
       end as defect
from public.driver_assignments a
left join public.organization_members m on m.id = a.member_id
left join public.vehicles v on v.id = a.vehicle_id
where a.unassigned_at is null
  and (
       a.member_id is null
    or m.id is null
    or m.role <> 'driver'
    or m.user_id <> a.driver_user_id
    or v.id is null
    or v.organization_id <> a.organization_id
    or v.deleted_at is not null
  );


-- -----------------------------------------------------------------------------
-- 9. The bootcamp limitation must hold: one active driver per vehicle, one
--    active vehicle per driver.
--    Expected: 0 rows.
-- -----------------------------------------------------------------------------
select 'vehicle' as scope, vehicle_id::text as subject, count(*) as active_rows
from public.driver_assignments where unassigned_at is null
group by vehicle_id having count(*) > 1
union all
select 'driver', driver_user_id::text, count(*)
from public.driver_assignments where unassigned_at is null
group by driver_user_id having count(*) > 1;

-- =============================================================================
-- End of audit
-- =============================================================================

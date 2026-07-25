-- =============================================================================
-- Vin.ID Fleet Lite — indexes and a cost constraint for the Fleet Manager layer
-- =============================================================================
-- Driven by the query patterns the Fleet Manager surfaces actually issue, not by
-- speculation. Each index below backs a specific query added in this phase:
--
--   maintenance_logs (organization_id, performed_at) where deleted_at is null
--       Monthly cost roll-up: "sum cost for this organization in this month".
--       Without it the cost query is a full scan of the org's entire service
--       history on every dashboard render.
--
--   vehicle_documents (organization_id, expiry_date) where expiry_date not null
--       Expired / expiring document counts. The dashboard previously ignored
--       this table entirely and reported vehicle-level columns as "documents";
--       now that it is queried for real, it needs the same treatment the
--       equivalent vehicles.* expiry columns already got.
--
--   issue_logs (organization_id, status) where deleted_at is null
--       Open-issue counts and the high-priority (severity) split.
--
-- The existing vehicles indexes (organization_id + operational_status /
-- next_service_date / test_expiry_date / insurance_expiry_date) already cover
-- the vehicle side, so nothing is added there.
--
-- CONSTRAINT: `maintenance_logs.cost` had no lower bound, so a negative cost
-- could silently subtract from a monthly total and make the fleet look cheaper
-- than it is. Added as NOT VALID: it applies to every new and updated row, but
-- does not fail the migration on pre-existing production data. Existing rows can
-- be validated later with `ALTER TABLE ... VALIDATE CONSTRAINT`, once any legacy
-- negatives have been corrected.
--
-- Non-destructive and idempotent.
-- =============================================================================

create index if not exists maintenance_logs_org_performed_at_idx
  on public.maintenance_logs (organization_id, performed_at)
  where deleted_at is null;

create index if not exists vehicle_documents_org_expiry_idx
  on public.vehicle_documents (organization_id, expiry_date)
  where expiry_date is not null and deleted_at is null;

create index if not exists issue_logs_org_status_idx
  on public.issue_logs (organization_id, status)
  where deleted_at is null;

-- Guard the cost column without breaking legacy rows.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.maintenance_logs'::regclass
      and conname = 'maintenance_logs_cost_nonnegative'
  ) then
    alter table public.maintenance_logs
      add constraint maintenance_logs_cost_nonnegative
      check (cost is null or cost >= 0)
      not valid;
  end if;
end $$;

comment on constraint maintenance_logs_cost_nonnegative on public.maintenance_logs is
  'A recorded cost may be unknown (NULL) but never negative. NOT VALID so legacy rows are untouched; new and updated rows are enforced.';

-- =============================================================================
-- End of migration
-- =============================================================================

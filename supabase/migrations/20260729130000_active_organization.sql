-- =============================================================================
-- Vin.ID multi-workspace — M2: the active workspace pointer
-- =============================================================================
-- A user who belongs to several organizations needs somewhere to record which
-- one they are currently looking at. That is all this column is.
--
-- IT IS A PREFERENCE, NEVER EVIDENCE. This is the single most important
-- property of the whole change, so it is enforced in exactly one place —
-- current_org_id() (M3) JOINS this pointer to a live organization_members row
-- for auth.uid(). A pointer at an organization the caller does not belong to
-- does not fail loudly and does not grant access: it simply does not match, and
-- resolution falls through to the caller's own default workspace.
--
-- That is why the column is nullable with no default and no backfill. NULL
-- means "no preference recorded", which resolves to exactly the behaviour every
-- existing user has today.
--
-- ON DELETE SET NULL: deleting an organization must not leave a dangling
-- pointer behind. RESTRICT would also block the deletion of an organization
-- somebody happens to have selected, which would be absurd.
--
-- Additive and idempotent. Old code never reads this column.
-- =============================================================================

alter table public.profiles
  add column if not exists active_organization_id uuid
    references public.organizations(id) on delete set null;

comment on column public.profiles.active_organization_id is
  'UI preference: which workspace this user is currently viewing. Validated against an active organization_members row on every read (see current_org_id). Never an authorization input — a forged or stale value resolves to the user''s default workspace, never to the pointed-at tenant.';

create index if not exists profiles_active_organization_idx
  on public.profiles (active_organization_id)
  where active_organization_id is not null;

-- No backfill. NULL resolves through the same fallback chain that produces
-- today's behaviour for every existing user, so this migration changes nothing
-- observable until a user actually switches workspace.

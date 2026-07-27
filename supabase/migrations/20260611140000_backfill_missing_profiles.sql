-- Backfill a profile for any authenticated user that has lost one.
--
-- WHY THIS EXISTS. `handle_new_user()` creates a profile for every new auth
-- user, so a user without one is a data defect, not a normal state. Production
-- has exactly that: an active account whose profile row was removed after
-- signup (no `audit_logs` or `beta_feedback` row records it, so it happened
-- outside the application).
--
-- WHY IT MUST RUN BEFORE 20260722120000. That migration creates one personal
-- organization per row in `public.profiles` and backfills `organization_id`
-- from the owner's profile. A user with no profile therefore receives no
-- organization, every row they own keeps `organization_id = NULL`, and — because
-- the column is nullable — the migration SUCCEEDS while making that data
-- permanently invisible, since every new policy is
-- `organization_id = public.current_org_id()` and NULL never matches.
--
-- This file is numbered 20260611140000 so it lands after the last historical
-- migration (20260611130000) and before the Fleet chain, which is exactly the
-- window in which the fix is meaningful.
--
-- WHAT IT DELIBERATELY DOES NOT DO. It does not invent an organization or a
-- membership — those columns do not exist yet, and inventing them here would
-- pre-empt the migration that owns that decision. It does not touch ownership:
-- no `owner_user_id` is read or written, so no vehicle or child row moves. It
-- does not modify any profile that already exists.

do $$
declare
  v_missing  int;
  v_inserted int;
  v_bad      int;
begin
  -- Users that should have a profile and do not. Soft-deleted users are
  -- excluded: they are on their way out and must not be resurrected here.
  select count(*) into v_missing
  from auth.users u
  left join public.profiles p on p.id = u.id
  where p.id is null and u.deleted_at is null;

  if v_missing = 0 then
    raise notice 'backfill_missing_profiles: nothing to do';
    return;
  end if;

  -- Loud failure on a malformed account. A user with no email cannot have come
  -- from the signup flow, so it is not something to silently paper over.
  select count(*) into v_bad
  from auth.users u
  left join public.profiles p on p.id = u.id
  where p.id is null and u.deleted_at is null
    and coalesce(btrim(u.email), '') = '';

  if v_bad > 0 then
    raise exception
      'backfill_missing_profiles: % of % profile-less users have no email; refusing to guess', v_bad, v_missing;
  end if;

  insert into public.profiles (id, full_name)
  select u.id,
         -- Only identity fields that the user themselves supplied at signup.
         -- `locale`, `created_at` and `updated_at` are left to their column
         -- defaults ('en', now(), now()) rather than invented here.
         nullif(btrim(coalesce(u.raw_user_meta_data->>'full_name',
                               u.raw_user_meta_data->>'name',
                               '')), '')
  from auth.users u
  left join public.profiles p on p.id = u.id
  where p.id is null and u.deleted_at is null
  -- Idempotent: a concurrent signup trigger that wins the race is not an error.
  on conflict (id) do nothing;

  get diagnostics v_inserted = row_count;
  raise notice 'backfill_missing_profiles: % missing, % inserted', v_missing, v_inserted;
end $$;

-- Verification (expect 0):
--   select count(*) from auth.users u
--   left join public.profiles p on p.id = u.id
--   where p.id is null and u.deleted_at is null;
